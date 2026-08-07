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
    options.skipSchemas.length ? `schemaname NOT IN (${pgQuoteStrings(options.skipSchemas)})` : ``,
    scope.tablePredicate('schemaname', 'tablename'),
  ].filter((clause) => clause);
  const result = await client.query<{
    schema: string;
    table: string;
    name: string;
    src: string;
  }>(`
    SELECT
      schemaname AS "schema",
      tablename AS "table",
      indexname AS "name",
      indexdef || E'\\n' AS "src"
    FROM pg_indexes
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ``}
  `);
  return result.rows.map((row) => {
    row.src = row.src.replace(/^CREATE(\sUNIQUE)?\sINDEX/i, (a) => `${a} IF NOT EXISTS`);
    return row;
  });
}
