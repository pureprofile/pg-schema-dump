import type { Client } from 'pg';

import { pgQuoteStrings, notExtensionOwned } from '../pg-helpers';
import type { ResolvedScope } from '../scope';
import { resolveScope } from '../scope';
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
    args: string;
  }>(`
    SELECT
      n.nspname AS "schema",
      p.proname AS "name",
      pg_get_functiondef(p.oid) AS "src",
      pg_get_function_identity_arguments(p.oid) AS "args"
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prokind <> 'a'
      AND ${notExtensionOwned('pg_proc', 'p.oid')}
      ${options.skipFunctions.length ? `AND p.proname NOT IN (${pgQuoteStrings(options.skipFunctions)})` : ``}
      ${options.skipSchemas.length ? `AND n.nspname NOT IN (${pgQuoteStrings(options.skipSchemas)})` : ``}
      AND probin IS NULL
      ${scopeClause}
    ORDER BY 1, 2, 4;
  `);
  // Overloads collapse to the same file name and get .v2/.v3 suffixes from the
  // writer, so their relative order has to be stable or those suffixes shuffle
  // between dumps of equivalent databases. ORDER BY includes the identity
  // arguments for exactly that reason; args is not otherwise emitted.
  return result.rows.map((row) => ({ schema: row.schema, name: row.name, src: row.src }));
}
