import { Client } from 'pg';
import { pgQuoteStrings, notExtensionOwned } from '../pg-helpers';
import { resolveScope, ResolvedScope } from '../scope';

export async function collectIndexes(
  client: Client,
  options: {
    skipSchemas: string[];
    scope?: ResolvedScope;
  }
) {
  const scope = options.scope || resolveScope();
  const clauses = [
    // Skip indexes that a constraint creates implicitly: emitting both the
    // constraint and this index would create the same index twice. Only PRIMARY
    // KEY, UNIQUE and EXCLUDE constraints own an index that way. A FOREIGN KEY
    // also populates conindid, but pointing at the index on the *referenced*
    // table, which it merely uses - excluding those would drop indexes that
    // foreign keys elsewhere depend on, and the restore then fails with
    // "there is no unique constraint matching given keys".
    `NOT EXISTS (
      SELECT 1 FROM pg_constraint con
      WHERE con.conindid = i.indexrelid AND con.contype IN ('p','u','x')
    )`,
    `c.relkind IN ('r','p')`,
    notExtensionOwned('pg_class', 'c.oid'),
    options.skipSchemas.length ? `n.nspname NOT IN (${pgQuoteStrings(options.skipSchemas)})` : ``,
    scope.tablePredicate('n.nspname', 'c.relname'),
  ].filter((clause) => clause);
  const result = await client.query<{
    schema: string;
    table: string;
    name: string;
    src: string;
  }>(`
    SELECT
      n.nspname AS "schema",
      c.relname AS "table",
      ic.relname AS "name",
      pg_get_indexdef(i.indexrelid) || E'\\n' AS "src"
    FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE ${clauses.join(' AND ')}
    ORDER BY 1, 2, 3
  `);
  return result.rows.map((row) => {
    row.src = row.src.replace(/^CREATE(\sUNIQUE)?\sINDEX/i, (a) => `${a} IF NOT EXISTS`);
    return row;
  });
}
