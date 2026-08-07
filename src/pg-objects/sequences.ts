import { Client } from 'pg';
import { pgQuoteStrings, notExtensionOwned } from '../pg-helpers';
import { resolveScope, ResolvedScope } from '../scope';
import { quoteQualified } from '../fs-schema-helpers';

/**
 * The column a sequence belongs to.
 *
 * Kept as three fields rather than one dotted string: every Postgres identifier may
 * legally contain a dot, so flattening and re-splitting would attach the sequence to
 * the wrong table, or to none, and silently drop its OWNED BY.
 */
export interface OwnedBy {
  schema: string;
  table: string;
  column: string;
}
import { inScopeFunctionOidsSql, namedByInScopeRelationSql } from './scope-sql';

export async function collectSequences(
  client: Client,
  options: {
    skipSchemas?: string[];
    scope?: ResolvedScope;
  } = {}
) {
  const skipSchemas = options.skipSchemas || [];
  const scope = options.scope || resolveScope();
  // A sequence is in scope when its schema was opted into wholesale, when an in-scope
  // relation owns it, when an in-scope relation's own definition names it, or when an
  // in-scope function's body names it.
  //
  // None of the last three is optional. Plenty of legacy sequences have no owner and are
  // reached only through a `default nextval(...)`, and dropping one makes the referencing
  // CREATE TABLE fail. A `nextval()` inside a trigger function is invisible to pg_depend
  // altogether, and dropping that one fails nothing until the first insert that fires the
  // trigger. Using the schema predicate instead of all this would pull in every sequence
  // in a schema just because one of its tables was named.
  const scopeClause = scope.active
    ? `
      AND (
        ${scope.includedSchemaPredicate('n.nspname')}
        OR EXISTS (
          -- Ownership runs the other way round to the walk below: the sequence is the
          -- dependent object and the table it belongs to is the referenced one.
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
        -- Any in-scope relation whose definition names the sequence, not just a column
        -- default: a CHECK constraint, an expression index, a trigger WHEN clause and a
        -- view body can each name one, and each fails just as hard without it.
        OR ${namedByInScopeRelationSql(scope, { refClass: 'pg_class', refOid: 'c.oid' })}
        OR EXISTS (
          SELECT 1 FROM pg_proc fp
          WHERE fp.oid IN (${inScopeFunctionOidsSql(scope)})
            AND fp.prosrc IS NOT NULL
            -- Case-insensitive for the same reason as the function closure: prosrc is
            -- the body as written, so nextval('MY_SEQ') would not match the folded
            -- catalog name and the sequence would be silently dropped.
            AND strpos(lower(fp.prosrc), lower(c.relname)) > 0
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
    ownedBy: OwnedBy | null;
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
        SELECT jsonb_build_object('schema', rn.nspname, 'table', rc.relname, 'column', a.attname)
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
    ORDER BY 1, 2
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
