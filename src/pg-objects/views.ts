import { Client } from 'pg';
import { pgQuoteStrings } from '../pg-helpers';

export async function collectViews(
  client: Client,
  options: {
    skipSchemas: string[];
  }
) {
  const result = await client.query<{
    schema: string;
    name: string;
    src: string;
  }>(`
    SELECT
      v.schemaname AS "schema",
      v.viewname AS "name",
      v.definition AS "src"
    FROM pg_views v
    ${options.skipSchemas.length ? `WHERE schemaname NOT IN (${pgQuoteStrings(options.skipSchemas)})` : ``}
  `);
  return result.rows;
}
