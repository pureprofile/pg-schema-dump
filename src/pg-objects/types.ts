import { Client } from 'pg';
import { pgStringArray, pgQuoteString } from '../pg-helpers';
import { ResolvedScope } from '../scope';

// Enum types have no schema/table association in the current query, so `scope`
// is accepted for interface consistency with the other collectors but is a
// no-op here (see docs/TODO.md).
export async function collectTypes(client: Client, _options: { scope?: ResolvedScope } = {}) {
  const result = await client.query<{
    type_name: string;
    enum_values: string;
  }>(`
    WITH types AS (
      SELECT
        t.typname AS "type_name",
        e.enumsortorder AS "enum_order",
        e.enumlabel AS "enum_label"
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      ORDER BY 1,2
    )
    SELECT
      "type_name",
      array_agg("enum_label") AS "enum_values"
    FROM types GROUP BY 1    
  `);
  return result.rows.map((row) => {
    return {
      name: row.type_name,
      src: `CREATE TYPE "${row.type_name}" AS ENUM (${pgStringArray(row.enum_values).map(pgQuoteString)})`,
    };
  });
}
