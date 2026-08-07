import { Client } from 'pg';
import { pgQuoteStrings, notExtensionOwned } from '../pg-helpers';
import { resolveScope, ResolvedScope } from '../scope';
import { quoteQualified } from '../fs-schema-helpers';
import { inScopeFunctionOidsSql } from './scope-sql';

export async function collectSequences(
  client: Client,
  options: {
    skipSchemas?: string[];
    scope?: ResolvedScope;
  } = {}
) {
  const skipSchemas = options.skipSchemas || [];
  const scope = options.scope || resolveScope();
  // A sequence is in scope when its schema was opted into wholesale, when an
  // in-scope table owns it, when an in-scope table's column default calls it, or
  // when an in-scope function's body names it - a nextval() inside a trigger
  // function is invisible to pg_depend, and the restore fails on the first insert
  // that fires the trigger.
  // That last case is not optional: plenty of legacy sequences have no owner and
  // are reached only through a `default nextval(...)`, and dropping them makes
  // the referencing CREATE TABLE fail. Using schemaPredicate instead would pull
  // in every sequence in a schema just because one of its tables was named.
  const scopeClause = scope.active
    ? `
      AND (
        ${scope.includedSchemaPredicate('n.nspname')}
        OR EXISTS (
          SELECT 1
          FROM pg_depend dep
          JOIN pg_class rc ON rc.oid = dep.refobjid
          JOIN pg_namespace rn ON rn.oid = rc.relnamespace
          WHERE dep.objid = c.oid
            AND dep.classid = 'pg_class'::regclass
            AND dep.refclassid = 'pg_class'::regclass
            AND dep.deptype = 'a'
            AND ${scope.tablePredicate('rn.nspname', 'rc.relname')}
        )
        OR EXISTS (
          SELECT 1
          FROM pg_depend dep
          JOIN pg_attrdef ad ON ad.oid = dep.objid AND dep.classid = 'pg_attrdef'::regclass
          JOIN pg_class rc ON rc.oid = ad.adrelid
          JOIN pg_namespace rn ON rn.oid = rc.relnamespace
          WHERE dep.refobjid = c.oid
            AND dep.refclassid = 'pg_class'::regclass
            AND ${scope.tablePredicate('rn.nspname', 'rc.relname')}
        )
        OR EXISTS (
          SELECT 1 FROM pg_proc fp
          WHERE fp.oid IN (${inScopeFunctionOidsSql(scope)})
            AND fp.prosrc IS NOT NULL
            AND strpos(fp.prosrc, c.relname) > 0
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
    seqtype: string;
    seqcache: string;
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
      format_type(s.seqtypid, NULL) AS "seqtype",
      s.seqcache AS "seqcache",
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
      AND ${notExtensionOwned('pg_class', 'c.oid')}
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
        CREATE SEQUENCE ${quoteQualified(row.schema, row.name)}
        AS ${row.seqtype}
        INCREMENT ${row.seqincrement}
        MINVALUE ${row.seqmin}
        MAXVALUE ${row.seqmax}
        START ${row.seqstart}
        CACHE ${row.seqcache}
        ${row.seqcycle ? 'CYCLE' : 'NO CYCLE'}
      `.trim(),
    };
  });
}
