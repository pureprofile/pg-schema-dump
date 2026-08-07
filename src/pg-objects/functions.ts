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
  // Functions are scoped by what in-scope tables actually depend on, rather than by
  // schema membership - on a large database that is the difference between a
  // hundred functions and several hundred.
  //
  // `seed` covers every way a table's own SQL can name a function. Column defaults
  // and trigger bodies are not enough on their own: a CHECK constraint, an
  // expression or partial index, a trigger WHEN clause, or a view body can each
  // reference one, and omitting it while still emitting the referencing SQL makes
  // the restore fail with "function does not exist". pg_depend records all of these
  // uniformly, keyed by the dependent object's class, so one query covers them by
  // resolving each class back to its owning relation.
  //
  // `closure` then follows function-to-function calls. pg_depend does not track
  // those - a plpgsql body is just text to Postgres - so the body is searched for
  // the callee's name. That is deliberately a plain substring test rather than a
  // word-boundary regex: a name appearing inside a longer identifier pulls in a
  // function that was not really needed, which costs one small file, whereas
  // missing a real call breaks the restore. Cheap over-inclusion beats that.
  const scopeClause = scope.active
    ? `
      AND (
        ${scope.includedSchemaPredicate('n.nspname')}
        OR ${scope.functionPredicate('n.nspname', 'p.proname')}
        OR p.oid IN (
          WITH RECURSIVE seed AS (
            SELECT dep.refobjid AS oid
            FROM pg_depend dep
            LEFT JOIN pg_attrdef ad ON dep.classid = 'pg_attrdef'::regclass AND ad.oid = dep.objid
            LEFT JOIN pg_constraint co ON dep.classid = 'pg_constraint'::regclass AND co.oid = dep.objid
            LEFT JOIN pg_rewrite rw ON dep.classid = 'pg_rewrite'::regclass AND rw.oid = dep.objid
            LEFT JOIN pg_trigger tg ON dep.classid = 'pg_trigger'::regclass AND tg.oid = dep.objid
            LEFT JOIN pg_index ix ON dep.classid = 'pg_class'::regclass AND ix.indexrelid = dep.objid
            JOIN pg_class rc ON rc.oid = COALESCE(ad.adrelid, co.conrelid, rw.ev_class, tg.tgrelid, ix.indrelid)
            JOIN pg_namespace rn ON rn.oid = rc.relnamespace
            WHERE dep.refclassid = 'pg_proc'::regclass
              AND ${scope.tablePredicate('rn.nspname', 'rc.relname')}
          ),
          closure AS (
            SELECT oid FROM seed
            UNION
            SELECT callee.oid
            FROM closure cl
            JOIN pg_proc caller ON caller.oid = cl.oid
            JOIN pg_proc callee ON callee.oid <> caller.oid
            JOIN pg_namespace calleen ON calleen.oid = callee.pronamespace
            WHERE caller.prosrc IS NOT NULL
              AND callee.prokind <> 'a'
              AND callee.probin IS NULL
              AND calleen.nspname NOT IN ('pg_catalog', 'information_schema')
              AND strpos(caller.prosrc, callee.proname) > 0
          )
          SELECT oid FROM closure
        )
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
      ${scopeClause}
    ORDER BY 1, 2;
  `);
  return result.rows;
}
