import { Client } from 'pg';
import { pgQuoteStrings } from '../pg-helpers';
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
    `NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = i.indexrelid)`,
    `c.relkind IN ('r','p')`,
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
