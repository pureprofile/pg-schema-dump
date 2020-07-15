import { Client } from 'pg';
import { pgQuoteStrings } from '../pg-helpers';

export async function collectFunctions(
  client: Client,
  options: {
    skipSchemas: string[];
    skipFunctions: string[];
  }
) {
  const result = await client.query<{
    schema: string;
    name: string;
    src: string;
  }>(`
    SELECT
      n.nspname AS "schema",
      p.proname AS "name",
      pg_get_functiondef(p.oid) AS "src"
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proisagg = FALSE
      ${options.skipFunctions.length ? `AND p.proname NOT IN (${pgQuoteStrings(options.skipFunctions)})` : ``}
      ${options.skipSchemas.length ? `AND n.nspname NOT IN (${pgQuoteStrings(options.skipSchemas)})` : ``}
      AND probin IS NULL;
  `);
  return result.rows;
}
