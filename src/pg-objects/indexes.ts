import { Client } from 'pg';
import { pgQuoteStrings } from '../pg-helpers';

export async function collectIndexes(
  client: Client,
  options: {
    skipSchemas: string[];
  }
) {
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
    ${options.skipSchemas.length ? `WHERE schemaname NOT IN (${pgQuoteStrings(options.skipSchemas)})` : ``}
  `);
  return result.rows.map((row) => {
    row.src = row.src.replace(/^CREATE(\sUNIQUE)?\sINDEX/i, (a) => `${a} IF NOT EXISTS`);
    return row;
  });
}
