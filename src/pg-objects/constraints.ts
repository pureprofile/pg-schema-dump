import type { Client } from 'pg';

import { pgQuoteStrings, notExtensionOwned } from '../pg-helpers';
import type { ResolvedScope } from '../scope';
import { resolveScope } from '../scope';

export type ConstraintType = 'p' | 'u' | 'c' | 'x' | 'f';

export interface Constraint {
  schema: string;
  table: string;
  name: string;
  type: ConstraintType;
  def: string;
}

export interface CollectedConstraints {
  constraints: Constraint[];

  /**
   * Foreign keys left out because their target table is out of scope. Reported
   * from here rather than re-derived by a second query, so the integrity log
   * cannot drift from what was actually dumped - and unlike a re-derivation, this
   * covers multi-column keys too.
   */
  droppedForeignKeys: { schema: string; table: string; name: string; target: string }[];
}

export async function collectConstraints(
  client: Client,
  options: { skipSchemas?: string[]; scope?: ResolvedScope } = {}
): Promise<CollectedConstraints> {
  const skipSchemas = options.skipSchemas || [];
  const scope = options.scope || resolveScope();
  const clauses = [
    `con.contype IN ('p','u','c','x','f')`,
    // collectTables only returns relkind 'r', and per-table objects are written into
    // their table's file, so anything keyed to a partitioned parent would be
    // collected and then silently dropped. Staying on 'r' keeps that impossible.
    `c.relkind = 'r'`,
    notExtensionOwned('pg_class', 'c.oid'),
    // ...and the constraint's own ownership, which is not the table's: an extension
    // may own a constraint on an ordinary table and recreate it itself on
    // CREATE EXTENSION.
    notExtensionOwned('pg_constraint', 'con.oid'),
    `NOT con.conislocal IS FALSE`, // skip constraints merely inherited from a parent
    skipSchemas.length ? `n.nspname NOT IN (${pgQuoteStrings(skipSchemas)})` : ``,
    scope.tablePredicate('n.nspname', 'c.relname'),
  ].filter((clause) => clause);
  const result = await client.query<
    Constraint & { targetSchema: string | null; targetTable: string | null; inScope: boolean }
  >(`
    SELECT
      n.nspname AS "schema",
      c.relname AS "table",
      con.conname AS "name",
      con.contype AS "type",
      pg_get_constraintdef(con.oid) AS "def",
      rn.nspname AS "targetSchema",
      rc.relname AS "targetTable",
      CASE
        WHEN con.contype <> 'f' THEN true
        ELSE ${scope.tablePredicate('rn.nspname', 'rc.relname')}
      END AS "inScope"
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_class rc ON rc.oid = con.confrelid
    LEFT JOIN pg_namespace rn ON rn.oid = rc.relnamespace
    WHERE ${clauses.join(' AND ')}
    ORDER BY 1, 2, 4, 3
  `);

  const constraints: Constraint[] = [];
  const droppedForeignKeys: CollectedConstraints['droppedForeignKeys'] = [];
  for (const row of result.rows) {
    if (row.inScope) {
      constraints.push({ schema: row.schema, table: row.table, name: row.name, type: row.type, def: row.def });
      continue;
    }
    // A foreign key pointing at a table this dump does not contain cannot be
    // restored, so it is omitted rather than emitted.
    droppedForeignKeys.push({
      schema: row.schema,
      table: row.table,
      name: row.name,
      target: `${row.targetSchema}.${row.targetTable}`,
    });
  }
  return { constraints, droppedForeignKeys };
}
