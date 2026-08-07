import { ResolvedScope } from '../scope';

/**
 * Relation kinds whose presence in a dump is decided by the scope.
 *
 * Everything except a view: an ordinary table, a materialized view, a partitioned
 * parent, a sequence, a foreign table. A dependency on one of these is satisfied only
 * if the scope keeps it - a foreign table included, since the dump never contains one,
 * so reading it is as fatal as reading an out-of-scope table.
 *
 * Views are excluded deliberately and judged separately: a view is never named by a
 * table scope, so testing it with the scope predicate would reject every chain of
 * views. See `collectViews`.
 */
export const DEPENDABLE_RELATION_KINDS = `'r','m','p','S','f'`;

/**
 * FROM/JOIN chain resolving every `pg_depend` row to the relation whose own definition
 * carries the dependency.
 *
 * This is the one piece of SQL in the project that has to be written identically in
 * more than one place, so it is written here once. Postgres records these dependencies
 * uniformly, keyed by the class of the *dependent* object - a column default
 * (`pg_attrdef`), a CHECK constraint, a rewrite rule, a trigger, an expression index -
 * but each class stores its owning relation in a different column, so resolving "which
 * relation does this dependency belong to" means the same five-way join every time.
 * Getting it wrong is invisible: the referenced object is simply absent from the dump,
 * and the failure surfaces at restore time or later.
 *
 * Exposes `dpd` (the `pg_depend` row), `dep_owner` (the owning relation) and
 * `dep_owner_ns` (its schema). The aliases are deliberately distinctive so this can be
 * nested inside a collector's own query without colliding with it.
 */
export function dependencyOwnerFromSql(): string {
  return `
    FROM pg_depend dpd
    LEFT JOIN pg_attrdef dpd_ad ON dpd.classid = 'pg_attrdef'::regclass AND dpd_ad.oid = dpd.objid
    LEFT JOIN pg_constraint dpd_co ON dpd.classid = 'pg_constraint'::regclass AND dpd_co.oid = dpd.objid
    LEFT JOIN pg_rewrite dpd_rw ON dpd.classid = 'pg_rewrite'::regclass AND dpd_rw.oid = dpd.objid
    LEFT JOIN pg_trigger dpd_tg ON dpd.classid = 'pg_trigger'::regclass AND dpd_tg.oid = dpd.objid
    LEFT JOIN pg_index dpd_ix ON dpd.classid = 'pg_class'::regclass AND dpd_ix.indexrelid = dpd.objid
    JOIN pg_class dep_owner ON dep_owner.oid = COALESCE(
      dpd_ad.adrelid, dpd_co.conrelid, dpd_rw.ev_class, dpd_tg.tgrelid, dpd_ix.indrelid
    )
    JOIN pg_namespace dep_owner_ns ON dep_owner_ns.oid = dep_owner.relnamespace
  `;
}

/**
 * SQL for "this view reads nothing the dump will not contain".
 *
 * `relOid` is an expression for the view's oid. Only relation dependencies are checked;
 * a view reading another view is settled by `collectViews`' fixpoint, which is the only
 * place that knows which views survived.
 */
export function viewReadsOnlyInScopeRelationsSql(scope: ResolvedScope, relOid: string): string {
  return `NOT EXISTS (
    SELECT 1
    FROM pg_rewrite vrw
    JOIN pg_depend vdep ON vdep.objid = vrw.oid AND vdep.classid = 'pg_rewrite'::regclass
    JOIN pg_class vdc ON vdc.oid = vdep.refobjid
    JOIN pg_namespace vdn ON vdn.oid = vdc.relnamespace
    WHERE vrw.ev_class = ${relOid}
      AND vdep.refclassid = 'pg_class'::regclass
      AND vdep.refobjid <> ${relOid}
      AND vdc.relkind IN (${DEPENDABLE_RELATION_KINDS})
      AND NOT (${scope.tablePredicate('vdn.nspname', 'vdc.relname')})
  )`;
}

/**
 * Predicate on the relation `dependencyOwnerFromSql` resolved: is it one whose
 * definition the dump will contain?
 *
 * A relation named by the scope, or a view that reads nothing out of scope. The second
 * case is not generosity, it breaks a circularity: for a rewrite rule the owning
 * relation is the *view*, which a table-list scope never names, so judging it by the
 * predicate alone would leave the view's functions unseeded - and `collectViews` would
 * then drop the view for depending on a function this set had just declared absent. A
 * view excluded purely because it was excluded. Over-including a function costs one
 * small file; the circularity costs the view.
 */
export function dependencyOwnerInScopeSql(scope: ResolvedScope): string {
  return `(
    ${scope.tablePredicate('dep_owner_ns.nspname', 'dep_owner.relname')}
    OR (
      dep_owner.relkind = 'v'
      AND ${viewReadsOnlyInScopeRelationsSql(scope, 'dep_owner.oid')}
    )
  )`;
}

/**
 * SQL for "some relation the dump will contain names this object in its own definition".
 *
 * `refClass` is the catalog the referenced object lives in (`pg_proc`, `pg_class`, …)
 * and `refOid` an expression for its oid.
 */
export function namedByInScopeRelationSql(
  scope: ResolvedScope,
  { refClass, refOid }: { refClass: string; refOid: string }
): string {
  return `EXISTS (
    SELECT 1
    ${dependencyOwnerFromSql()}
    WHERE dpd.refclassid = '${refClass}'::regclass
      AND dpd.refobjid = ${refOid}
      AND ${dependencyOwnerInScopeSql(scope)}
  )`;
}

/**
 * SQL for the set of `pg_proc` oids an active scope keeps.
 *
 * Shared by the function collector (to decide what to dump), the sequence collector (to
 * find sequences named inside those function bodies) and the view collector (to decide
 * whether a view's functions will be present). All three need the same answer, so it is
 * built in one place rather than restated per collector.
 *
 * `seed` is every function named by the definition of a relation the dump will contain.
 *
 * `closure` then follows function-to-function calls, which pg_depend cannot see - a
 * plpgsql body is only text to Postgres - by searching the body for the callee's name.
 * That is a plain substring test on purpose: pulling in an unneeded function costs one
 * small file, missing a real call breaks the restore.
 */
export function inScopeFunctionOidsSql(scope: ResolvedScope): string {
  return `
    WITH RECURSIVE seed AS (
      SELECT dpd.refobjid AS oid
      ${dependencyOwnerFromSql()}
      WHERE dpd.refclassid = 'pg_proc'::regclass
        AND ${dependencyOwnerInScopeSql(scope)}
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
        -- Case-insensitive: prosrc is the body as *written*, while proname is the
        -- folded catalog name, so a body calling HELPERS.INNER_FN() resolves live but
        -- would not match its own callee's lowercase name.
        AND strpos(lower(caller.prosrc), lower(callee.proname)) > 0
    )
    SELECT oid FROM closure
  `;
}
