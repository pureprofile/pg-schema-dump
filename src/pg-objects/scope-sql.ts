import { ResolvedScope } from '../scope';

/**
 * SQL for the set of `pg_proc` oids an active scope keeps.
 *
 * Shared by the function collector (to decide what to dump) and the sequence
 * collector (to find sequences named inside those function bodies). Both need the
 * same answer, so it is built in one place rather than restated per collector.
 *
 * `seed` is everything an in-scope table's own SQL can name. pg_depend records
 * column defaults, CHECK constraints, expression indexes, trigger WHEN clauses and
 * view bodies uniformly, keyed by the dependent object's class, so one query
 * resolves each class back to its owning relation.
 *
 * `closure` then follows function-to-function calls, which pg_depend cannot see -
 * a plpgsql body is only text to Postgres - by searching the body for the callee's
 * name. That is a plain substring test on purpose: pulling in an unneeded function
 * costs one small file, missing a real call breaks the restore.
 */
export function inScopeFunctionOidsSql(scope: ResolvedScope): string {
  return `
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
        AND (
          ${scope.tablePredicate('rn.nspname', 'rc.relname')}
          -- For a rewrite rule the owning relation is the *view*, which a table-list
          -- scope never names. Judging it by the predicate alone would leave its
          -- functions unseeded, and collectViews would then drop the view for
          -- depending on a function this set says is absent - a view excluded purely
          -- because it was excluded. So a view that reads nothing out of scope counts
          -- as in scope here. Over-including costs one small file; the circularity
          -- costs the view.
          OR (
            rc.relkind = 'v'
            AND NOT EXISTS (
              SELECT 1
              FROM pg_rewrite vrw
              JOIN pg_depend vdep ON vdep.objid = vrw.oid AND vdep.classid = 'pg_rewrite'::regclass
              JOIN pg_class vdc ON vdc.oid = vdep.refobjid
              JOIN pg_namespace vdn ON vdn.oid = vdc.relnamespace
              WHERE vrw.ev_class = rc.oid
                AND vdep.refclassid = 'pg_class'::regclass
                AND vdep.refobjid <> rc.oid
                AND vdc.relkind IN ('r','m','p','S')
                AND NOT (${scope.tablePredicate('vdn.nspname', 'vdc.relname')})
            )
          )
        )
      UNION
      SELECT sp.oid
      FROM pg_proc sp
      JOIN pg_namespace sn ON sn.oid = sp.pronamespace
      WHERE ${scope.includedSchemaPredicate('sn.nspname')}
         OR ${scope.functionPredicate('sn.nspname', 'sp.proname')}
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
  `;
}
