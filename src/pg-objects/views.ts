import { Client } from 'pg';
import { pgQuoteStrings, notExtensionOwned } from '../pg-helpers';
import { resolveScope, ResolvedScope } from '../scope';

export interface View {
  schema: string;
  name: string;
  src: string;
}

export interface CollectedViews {
  views: View[];

  /**
   * Views left out because something they read is out of scope, with the first
   * offending dependency. Reported from here rather than re-derived by a second
   * query, so the integrity log cannot drift from what was actually dumped.
   */
  excluded: Array<{ view: string; cause: string }>;
}

export async function collectViews(
  client: Client,
  options: {
    skipSchemas: string[];
    scope?: ResolvedScope;
  }
): Promise<CollectedViews> {
  const scope = options.scope || resolveScope();
  const clauses = [
    `c.relkind = 'v'`,
    notExtensionOwned('pg_class', 'c.oid'),
    options.skipSchemas.length ? `n.nspname NOT IN (${pgQuoteStrings(options.skipSchemas)})` : ``,
  ].filter((clause) => clause);
  // A view is only restorable when everything it reads is present. The offending
  // dependency is selected rather than filtered on, so one query both decides
  // inclusion and explains exclusion.
  //
  // Relations are not the only thing a view body can name - it can call a function
  // or read a sequence too, and either being absent fails the CREATE VIEW just the
  // same. Functions are matched against what the function collector would keep
  // (reachable from an in-scope table, or in a wholesale schema); anything else is
  // treated as out of scope.
  const result = await client.query<View & { cause: string | null }>(`
    SELECT
      n.nspname AS "schema",
      c.relname AS "name",
      pg_get_viewdef(c.oid) AS "src",
      (
        SELECT min(cause) FROM (
          SELECT dn.nspname || '.' || dc.relname AS cause
          FROM pg_rewrite rw
          JOIN pg_depend dep ON dep.objid = rw.oid AND dep.classid = 'pg_rewrite'::regclass
          JOIN pg_class dc ON dc.oid = dep.refobjid
          JOIN pg_namespace dn ON dn.oid = dc.relnamespace
          WHERE rw.ev_class = c.oid
            AND dep.refclassid = 'pg_class'::regclass
            AND dep.refobjid <> c.oid
            AND dc.relkind IN ('r','v','m','p','S')
            AND NOT (${scope.tablePredicate('dn.nspname', 'dc.relname')})
          UNION ALL
          SELECT fn.nspname || '.' || fp.proname AS cause
          FROM pg_rewrite rw
          JOIN pg_depend dep ON dep.objid = rw.oid AND dep.classid = 'pg_rewrite'::regclass
          JOIN pg_proc fp ON fp.oid = dep.refobjid
          JOIN pg_namespace fn ON fn.oid = fp.pronamespace
          WHERE rw.ev_class = c.oid
            AND dep.refclassid = 'pg_proc'::regclass
            AND fn.nspname NOT IN ('pg_catalog', 'information_schema')
            AND NOT ${scope.includedSchemaPredicate('fn.nspname')}
            AND NOT ${scope.functionPredicate('fn.nspname', 'fp.proname')}
            AND NOT EXISTS (
              SELECT 1
              FROM pg_depend d2
              LEFT JOIN pg_attrdef ad ON d2.classid = 'pg_attrdef'::regclass AND ad.oid = d2.objid
              LEFT JOIN pg_constraint co ON d2.classid = 'pg_constraint'::regclass AND co.oid = d2.objid
              LEFT JOIN pg_rewrite rw2 ON d2.classid = 'pg_rewrite'::regclass AND rw2.oid = d2.objid
              LEFT JOIN pg_trigger tg ON d2.classid = 'pg_trigger'::regclass AND tg.oid = d2.objid
              LEFT JOIN pg_index ix ON d2.classid = 'pg_class'::regclass AND ix.indexrelid = d2.objid
              JOIN pg_class rc ON rc.oid = COALESCE(ad.adrelid, co.conrelid, rw2.ev_class, tg.tgrelid, ix.indrelid)
              JOIN pg_namespace rn ON rn.oid = rc.relnamespace
              WHERE d2.refclassid = 'pg_proc'::regclass
                AND d2.refobjid = fp.oid
                AND ${scope.tablePredicate('rn.nspname', 'rc.relname')}
            )
        ) causes
      ) AS "cause"
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE ${clauses.join(' AND ')}
    ORDER BY 1, 2
  `);

  const views: View[] = [];
  const excluded: CollectedViews['excluded'] = [];
  for (const row of result.rows) {
    if (row.cause === null) {
      views.push({ schema: row.schema, name: row.name, src: row.src });
      continue;
    }
    excluded.push({ view: `${row.schema}.${row.name}`, cause: row.cause });
  }
  return { views, excluded };
}
