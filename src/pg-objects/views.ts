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
  const skipSchemas = options.skipSchemas;
  const clauses = [
    `c.relkind = 'v'`,
    notExtensionOwned('pg_class', 'c.oid'),
    skipSchemas.length ? `n.nspname NOT IN (${pgQuoteStrings(skipSchemas)})` : ``,
  ].filter((clause) => clause);
  // A view is only restorable when everything it reads is present. The offending
  // dependencies are selected rather than filtered on, so one query both decides
  // inclusion and explains exclusion, and the explanation cannot drift from the
  // decision.
  //
  // Dependencies on *other views* are deliberately not judged by the scope predicate.
  // A view that survives is in the dump whether or not it was named, so a view
  // reading it is restorable too - but the predicate only knows the tables and
  // schemas that were named, so applying it to a view dependency would reject every
  // chain of views. Those come back separately and are settled by fixpoint below.
  //
  // Relations are not the only thing a view body can name - it can call a function
  // or read a sequence too, and either being absent fails the CREATE VIEW just the
  // same. Whether a function will actually be dumped comes from
  // inScopeFunctionOidsSql, the same set the function collector uses, so a view
  // calling a helper reached only through another in-scope function is not wrongly
  // excluded.
  const result = await client.query<View & { missing: string[] | null; viewDeps: string[] | null }>(`
    SELECT
      n.nspname AS "schema",
      c.relname AS "name",
      pg_get_viewdef(c.oid) AS "src",
      (
        SELECT array_agg(DISTINCT cause) FROM (
          SELECT dn.nspname || '.' || dc.relname AS cause
          FROM pg_rewrite rw
          JOIN pg_depend dep ON dep.objid = rw.oid AND dep.classid = 'pg_rewrite'::regclass
          JOIN pg_class dc ON dc.oid = dep.refobjid
          JOIN pg_namespace dn ON dn.oid = dc.relnamespace
          WHERE rw.ev_class = c.oid
            AND dep.refclassid = 'pg_class'::regclass
            AND dep.refobjid <> c.oid
            AND dc.relkind IN ('r','m','p','S')
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
            ${skipSchemas.length ? `AND fn.nspname NOT IN (${pgQuoteStrings(skipSchemas)})` : ``}
            AND fp.oid NOT IN (${inScopeFunctionOidsSql(scope)})
        ) causes
      ) AS "missing",
      (
        SELECT array_agg(DISTINCT dn.nspname || '.' || dc.relname)
        FROM pg_rewrite rw
        JOIN pg_depend dep ON dep.objid = rw.oid AND dep.classid = 'pg_rewrite'::regclass
        JOIN pg_class dc ON dc.oid = dep.refobjid
        JOIN pg_namespace dn ON dn.oid = dc.relnamespace
        WHERE rw.ev_class = c.oid
          AND dep.refclassid = 'pg_class'::regclass
          AND dep.refobjid <> c.oid
          AND dc.relkind = 'v'
      ) AS "viewDeps"
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE ${clauses.join(' AND ')}
    ORDER BY 1, 2
  `);

  // Settle the view-on-view chains. A view is keepable when nothing it reads is
  // missing from the dump and every view it reads is itself keepable. Dropping one
  // view can therefore drop whatever was built on top of it, so this repeats until
  // nothing changes rather than deciding in a single pass.
  const candidates = result.rows.map((row) => ({
    key: `${row.schema}.${row.name}`,
    row,
    missing: row.missing || [],
    viewDeps: row.viewDeps || [],
  }));
  const keepable = new Map(candidates.map((candidate) => [candidate.key, candidate]));
  const causeFor = new Map<string, string>();

  for (const candidate of candidates) {
    if (candidate.missing.length > 0) {
      keepable.delete(candidate.key);
      causeFor.set(candidate.key, [...candidate.missing].sort()[0]);
    }
  }
  let settled = false;
  while (!settled) {
    settled = true;
    for (const candidate of keepable.values()) {
      // A view dependency this collector never returned at all - a skipped schema, an
      // extension's own view - is as absent from the dump as an excluded one.
      const brokenDep = [...candidate.viewDeps].sort().find((dep) => !keepable.has(dep));
      if (brokenDep) {
        keepable.delete(candidate.key);
        causeFor.set(candidate.key, brokenDep);
        settled = false;
      }
    }
  }

  const views: View[] = [];
  const excluded: CollectedViews['excluded'] = [];
  for (const candidate of candidates) {
    const { schema, name, src } = candidate.row;
    if (keepable.has(candidate.key)) {
      views.push({ schema, name, src });
      continue;
    }
    excluded.push({ view: candidate.key, cause: causeFor.get(candidate.key) || 'unknown' });
  }
  return { views, excluded };
}
