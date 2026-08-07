import { Client } from 'pg';
import { pgQuoteStrings, notExtensionOwned } from '../pg-helpers';
import { resolveScope, ResolvedScope } from '../scope';

export async function collectFunctions(
  client: Client,
  options: {
    skipSchemas: string[];
    skipFunctions: string[];
    scope?: ResolvedScope;
  }
) {
  const scope = options.scope || resolveScope();
  const scopeClause = scope.active
    ? `
      AND (
        p.oid IN (
          SELECT t.tgfoid FROM pg_trigger t
          JOIN pg_class tc ON tc.oid = t.tgrelid
          JOIN pg_namespace tn ON tn.oid = tc.relnamespace
          WHERE NOT t.tgisinternal AND t.tgenabled = 'O' AND ${scope.tablePredicate('tn.nspname', 'tc.relname')}
          UNION
          SELECT dep.refobjid FROM pg_depend dep
          JOIN pg_attrdef ad ON ad.oid = dep.objid AND dep.classid = 'pg_attrdef'::regclass
          JOIN pg_class dc ON dc.oid = ad.adrelid
          JOIN pg_namespace dn ON dn.oid = dc.relnamespace
          WHERE dep.refclassid = 'pg_proc'::regclass AND ${scope.tablePredicate('dn.nspname', 'dc.relname')}
        )
        OR ${scope.functionPredicate('n.nspname', 'p.proname')}
      )
    `
    : ``;
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
      ${scopeClause};
  `);
  return result.rows;
}
