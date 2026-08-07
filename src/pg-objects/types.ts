import { Client } from 'pg';
import { pgStringArray, pgQuoteString, pgQuoteStrings, notExtensionOwned } from '../pg-helpers';
import { resolveScope, ResolvedScope } from '../scope';
import { quoteQualified } from '../fs-schema-helpers';
import { inScopeFunctionOidsSql } from './scope-sql';

export async function collectTypes(client: Client, options: { skipSchemas?: string[]; scope?: ResolvedScope } = {}) {
  const skipSchemas = options.skipSchemas || [];
  const scope = options.scope || resolveScope();
  // An enum is in scope when its schema was opted into wholesale, or when a column
  // of an in-scope table has that type. Scoping by schema membership instead both
  // over-includes (every unrelated enum in a schema, because one of its tables was
  // named) and under-includes (an enum a scoped table uses from *another* schema is
  // missed, and the CREATE TABLE then fails). The column check also matches arrays
  // of the enum (typelem) and domains over it (typbasetype).
  const scopeClause = scope.active
    ? `(
        ${scope.includedSchemaPredicate('n.nspname')}
        OR EXISTS (
          SELECT 1
          FROM pg_attribute a
          JOIN pg_class rc ON rc.oid = a.attrelid AND rc.relkind = 'r'
          JOIN pg_namespace rn ON rn.oid = rc.relnamespace
          JOIN pg_type at ON at.oid = a.atttypid
          WHERE a.attnum > 0
            AND NOT a.attisdropped
            AND (at.oid = t.oid OR at.typelem = t.oid OR at.typbasetype = t.oid)
            AND ${scope.tablePredicate('rn.nspname', 'rc.relname')}
        )
        OR EXISTS (
          -- An in-scope function may take or return the enum with no in-scope table
          -- column using it anywhere. The function is dumped regardless, and
          -- CREATE FUNCTION resolves its signature types eagerly - only the *body* is
          -- exempt under check_function_bodies = off - so the type must come with it.
          SELECT 1
          FROM pg_proc fp
          WHERE fp.oid IN (${inScopeFunctionOidsSql(scope)})
            AND (
              fp.prorettype = t.oid
              OR t.oid = ANY(fp.proargtypes::oid[])
              OR t.oid = ANY(COALESCE(fp.proallargtypes, fp.proargtypes::oid[]))
            )
        )
      )`
    : ``;
  const clauses = [
    notExtensionOwned('pg_type', 't.oid'),
    skipSchemas.length ? `n.nspname NOT IN (${pgQuoteStrings(skipSchemas)})` : ``,
    scopeClause,
  ].filter((clause) => clause);
  const result = await client.query<{
    schema: string;
    type_name: string;
    enum_values: string;
  }>(`
    WITH types AS (
      SELECT
        n.nspname AS "schema",
        t.typname AS "type_name",
        e.enumsortorder AS "enum_order",
        e.enumlabel AS "enum_label"
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      JOIN pg_enum e ON e.enumtypid = t.oid
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ``}
      ORDER BY 1, 2, 3
    )
    SELECT
      "schema",
      "type_name",
      array_agg("enum_label" ORDER BY "enum_order") AS "enum_values"
    FROM types GROUP BY 1, 2 ORDER BY 1, 2
  `);
  return result.rows.map((row) => {
    return {
      schema: row.schema,
      name: row.type_name,
      src: `CREATE TYPE ${quoteQualified(row.schema, row.type_name)} AS ENUM (${pgStringArray(row.enum_values).map(
        pgQuoteString
      )})`,
    };
  });
}
