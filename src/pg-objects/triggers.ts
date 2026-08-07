import { Client } from 'pg';
import { pgQuoteStrings } from '../pg-helpers';
import { resolveScope, ResolvedScope } from '../scope';

export async function collectTriggers(
  client: Client,
  options: {
    skipSchemas: string[];
    scope?: ResolvedScope;
  }
) {
  const scope = options.scope || resolveScope();
  const result = await client.query<{
    schema: string;
    table: string;
    name: string;
    src: string;
  }>(`
    SELECT
      n.nspname "schema",
      c.relname "table",
      t.tgname "name",
      pg_get_triggerdef(t.oid) "src"
    FROM
      pg_trigger t
    JOIN pg_class c ON
      c.oid = tgrelid
    JOIN pg_namespace n ON
      n.oid = c.relnamespace
    WHERE NOT t.tgisinternal
      AND t.tgenabled = 'O'
      ${options.skipSchemas.length ? `AND n.nspname NOT IN (${pgQuoteStrings(options.skipSchemas)})` : ``}
      AND ${scope.tablePredicate('n.nspname', 'c.relname')}
  `);
  return result.rows;
}
