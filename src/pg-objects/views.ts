import { Client } from 'pg';
import { pgQuoteStrings, notExtensionOwned } from '../pg-helpers';
import { resolveScope, ResolvedScope } from '../scope';
import { inScopeFunctionOidsSql } from './scope-sql';

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
  // same. Whether a function will actually be dumped comes from
  // inScopeFunctionOidsSql, the same set the function collector uses, so a view
  // calling a helper reached only through another in-scope function is not wrongly
  // excluded.
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
            AND fp.oid NOT IN (${inScopeFunctionOidsSql(scope)})
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
