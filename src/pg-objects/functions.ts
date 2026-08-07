import { Client } from 'pg';
import { pgQuoteStrings, notExtensionOwned } from '../pg-helpers';
import { resolveScope, ResolvedScope } from '../scope';
import { inScopeFunctionOidsSql } from './scope-sql';

export async function collectFunctions(
  client: Client,
  options: {
    skipSchemas: string[];
    skipFunctions: string[];
    scope?: ResolvedScope;
  }
) {
  const scope = options.scope || resolveScope();
  const scopeClause = scope.active ? `AND p.oid IN (${inScopeFunctionOidsSql(scope)})` : ``;
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
    WHERE p.prokind <> 'a'
      AND ${notExtensionOwned('pg_proc', 'p.oid')}
      ${options.skipFunctions.length ? `AND p.proname NOT IN (${pgQuoteStrings(options.skipFunctions)})` : ``}
      ${options.skipSchemas.length ? `AND n.nspname NOT IN (${pgQuoteStrings(options.skipSchemas)})` : ``}
      AND probin IS NULL
      ${scopeClause}
    ORDER BY 1, 2;
  `);
  return result.rows;
}
