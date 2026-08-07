import { Client } from 'pg';
import { pgQuoteStrings } from '../pg-helpers';
import { resolveScope, ResolvedScope } from '../scope';

export async function collectSequences(
  client: Client,
  options: {
    skipSchemas?: string[];
    scope?: ResolvedScope;
  } = {}
) {
  const skipSchemas = options.skipSchemas || [];
  const scope = options.scope || resolveScope();
  const scopeClause = scope.active
    ? `
      AND (
        ${scope.schemaPredicate('n.nspname')}
        OR EXISTS (
          SELECT 1
          FROM pg_depend dep
          JOIN pg_attribute a ON a.attrelid = dep.refobjid AND a.attnum = dep.refobjsubid
          JOIN pg_class rc ON rc.oid = dep.refobjid
          JOIN pg_namespace rn ON rn.oid = rc.relnamespace
          WHERE dep.objid = c.oid
            AND dep.classid = 'pg_class'::regclass
            AND dep.refclassid = 'pg_class'::regclass
            AND dep.deptype = 'a'
            AND ${scope.tablePredicate('rn.nspname', 'rc.relname')}
        )
      )
    `
    : ``;
  const result = await client.query<{
    schema: string;
    name: string;
    seqstart: string;
    seqincrement: string;
    seqmin: string;
    seqmax: string;
    seqcycle: boolean;
    ownedBy: string | null;
  }>(`
    SELECT
      n.nspname AS "schema",
      c.relname AS "name",
      s.seqstart AS "seqstart",
      s.seqincrement AS "seqincrement",
      s.seqmin AS "seqmin",
      s.seqmax AS "seqmax",
      s.seqcycle AS "seqcycle",
      (
        SELECT rn.nspname || '.' || rc.relname || '.' || a.attname
        FROM pg_depend dep
        JOIN pg_class rc ON rc.oid = dep.refobjid
        JOIN pg_namespace rn ON rn.oid = rc.relnamespace
        JOIN pg_attribute a ON a.attrelid = dep.refobjid AND a.attnum = dep.refobjsubid
        WHERE dep.objid = c.oid
          AND dep.classid = 'pg_class'::regclass
          AND dep.refclassid = 'pg_class'::regclass
          AND dep.deptype = 'a'
      ) AS "ownedBy"
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_sequence s ON s.seqrelid = c.oid
    WHERE c.relkind = 'S'
      ${skipSchemas.length ? `AND n.nspname NOT IN (${pgQuoteStrings(skipSchemas)})` : ``}
      ${scopeClause}
  `);
  return result.rows.map((row) => {
    return {
      schema: row.schema,
      name: row.name,
      // The matching ALTER SEQUENCE ... OWNED BY is emitted into the owning
      // table's file, not here: it cannot run until that table exists, and a
      // multi-statement file runs in one implicit transaction, so failing that
      // ALTER would roll the CREATE SEQUENCE back with it.
      ownedBy: row.ownedBy,
      src: `
        CREATE SEQUENCE ${row.schema}.${row.name}
        INCREMENT ${row.seqincrement}
        MINVALUE ${row.seqmin}
        MAXVALUE ${row.seqmax}
        START ${row.seqstart}
        ${row.seqcycle ? 'CYCLE' : 'NO CYCLE'}
      `.trim(),
    };
  });
}
