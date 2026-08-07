import { Client } from 'pg';
import { pgStringArray, pgQuoteString, pgQuoteStrings, notExtensionOwned } from '../pg-helpers';
import { resolveScope, ResolvedScope } from '../scope';

export async function collectTypes(client: Client, options: { skipSchemas?: string[]; scope?: ResolvedScope } = {}) {
  const skipSchemas = options.skipSchemas || [];
  const scope = options.scope || resolveScope();
  const clauses = [
    notExtensionOwned('pg_type', 't.oid'),
    skipSchemas.length ? `n.nspname NOT IN (${pgQuoteStrings(skipSchemas)})` : ``,
    scope.schemaPredicate('n.nspname'),
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
      src: `CREATE TYPE ${row.schema}."${row.type_name}" AS ENUM (${pgStringArray(row.enum_values).map(
        pgQuoteString
      )})`,
    };
  });
}
