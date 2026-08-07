import { Client } from 'pg';
import { pgQuoteStrings, notExtensionOwned } from '../pg-helpers';
import { resolveScope, ResolvedScope } from '../scope';

export async function collectViews(
  client: Client,
  options: {
    skipSchemas: string[];
    scope?: ResolvedScope;
  }
) {
  const scope = options.scope || resolveScope();
  const clauses = [
    `c.relkind = 'v'`,
    notExtensionOwned('pg_class', 'c.oid'),
    options.skipSchemas.length ? `n.nspname NOT IN (${pgQuoteStrings(options.skipSchemas)})` : ``,
    `NOT EXISTS (
      SELECT 1
      FROM pg_rewrite rw
      JOIN pg_depend dep ON dep.objid = rw.oid AND dep.classid = 'pg_rewrite'::regclass
      JOIN pg_class dc ON dc.oid = dep.refobjid
      JOIN pg_namespace dn ON dn.oid = dc.relnamespace
      WHERE rw.ev_class = c.oid
        AND dep.refclassid = 'pg_class'::regclass
        AND dep.refobjid <> c.oid
        AND dc.relkind IN ('r','v','m','p')
        AND NOT (${scope.tablePredicate('dn.nspname', 'dc.relname')})
    )`,
  ].filter((clause) => clause);
  const result = await client.query<{
    schema: string;
    name: string;
    src: string;
  }>(`
    SELECT
      n.nspname AS "schema",
      c.relname AS "name",
      pg_get_viewdef(c.oid) AS "src"
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE ${clauses.join(' AND ')}
  `);
  return result.rows;
}
