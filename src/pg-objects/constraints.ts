import { Client } from 'pg';
import { pgQuoteStrings, notExtensionOwned } from '../pg-helpers';
import { resolveScope, ResolvedScope } from '../scope';

export type ConstraintType = 'p' | 'u' | 'c' | 'x' | 'f';

export interface Constraint {
  schema: string;
  table: string;
  name: string;
  type: ConstraintType;
  def: string;
}

export async function collectConstraints(
  client: Client,
  options: { skipSchemas?: string[]; scope?: ResolvedScope } = {}
): Promise<Constraint[]> {
  const skipSchemas = options.skipSchemas || [];
  const scope = options.scope || resolveScope();
  const clauses = [
    `con.contype IN ('p','u','c','x','f')`,
    `c.relkind IN ('r','p')`,
    notExtensionOwned('pg_class', 'c.oid'),
    `NOT con.conislocal IS FALSE`, // skip constraints merely inherited from a parent
    skipSchemas.length ? `n.nspname NOT IN (${pgQuoteStrings(skipSchemas)})` : ``,
    scope.tablePredicate('n.nspname', 'c.relname'),
    `(
      con.contype <> 'f'
      OR EXISTS (
        SELECT 1 FROM pg_class rc
        JOIN pg_namespace rn ON rn.oid = rc.relnamespace
        WHERE rc.oid = con.confrelid
          AND ${scope.tablePredicate('rn.nspname', 'rc.relname')}
      )
    )`,
  ].filter((clause) => clause);
  const result = await client.query<Constraint>(`
    SELECT
      n.nspname AS "schema",
      c.relname AS "table",
      con.conname AS "name",
      con.contype AS "type",
      pg_get_constraintdef(con.oid) AS "def"
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE ${clauses.join(' AND ')}
    ORDER BY 1, 2, 4, 3
  `);
  return result.rows;
}
