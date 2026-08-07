import { Client } from 'pg';
import { notExtensionOwned, pgQuoteStrings } from '../pg-helpers';
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
      -- An extension may own a trigger on an ordinary table and recreate it itself,
      -- so dumping it into the table's file fails the restore on a duplicate. The
      -- ownership that matters is the trigger's, not the table's.
      AND ${notExtensionOwned('pg_trigger', 't.oid')}
      ${options.skipSchemas.length ? `AND n.nspname NOT IN (${pgQuoteStrings(options.skipSchemas)})` : ``}
      AND ${scope.tablePredicate('n.nspname', 'c.relname')}
    ORDER BY 1, 2, 3
  `);
  return result.rows;
}
