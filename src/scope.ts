import { pgQuoteString } from './pg-helpers';

export interface ScopeOptions {
  includeSchemas?: string[]; // whole-schema opt-in
  includeTables?: string[]; // 'schema.table' — the primary mechanism
  includeFunctions?: string[]; // 'schema.function' escape hatch
}

export interface ResolvedScope {
  active: boolean;

  /** SQL boolean expression testing whether (nspCol, relCol) is in scope. Returns 'true' when inactive. */
  tablePredicate(nspCol: string, relCol: string): string;

  /**
   * SQL boolean: was this schema opted into *wholesale* via includeSchemas?
   *
   * Deliberately NOT true for a schema that merely contains one included table.
   * Anything belonging to a specific table - sequences, enums - must be matched
   * through that table, or naming one table drags in every such object in its
   * schema. Use this only for "the caller asked for this whole schema".
   */
  includedSchemaPredicate(nspCol: string): string;

  /** SQL boolean for the includeFunctions escape hatch. Returns 'false' when empty. */
  functionPredicate(nspCol: string, proCol: string): string;
}

function textArray(values: string[]): string {
  return `ARRAY[${values.map(pgQuoteString).join(', ')}]::text[]`;
}

export function resolveScope(options?: ScopeOptions): ResolvedScope {
  const includeSchemas = options?.includeSchemas || [];
  const includeTables = options?.includeTables || [];
  const includeFunctions = options?.includeFunctions || [];

  const active = includeSchemas.length > 0 || includeTables.length > 0 || includeFunctions.length > 0;

  return {
    active,
    tablePredicate(nspCol: string, relCol: string): string {
      if (!active) {
        return 'true';
      }
      const disjuncts: string[] = [];
      if (includeSchemas.length > 0) {
        disjuncts.push(`${nspCol} = ANY(${textArray(includeSchemas)})`);
      }
      if (includeTables.length > 0) {
        disjuncts.push(`(${nspCol} || '.' || ${relCol}) = ANY(${textArray(includeTables)})`);
      }
      if (disjuncts.length === 0) {
        return 'false';
      }
      return `(${disjuncts.join(' OR ')})`;
    },
    includedSchemaPredicate(nspCol: string): string {
      if (!active) {
        return 'true';
      }
      if (includeSchemas.length === 0) {
        return 'false';
      }
      return `(${nspCol} = ANY(${textArray(includeSchemas)}))`;
    },
    functionPredicate(nspCol: string, proCol: string): string {
      if (includeFunctions.length === 0) {
        return 'false';
      }
      return `((${nspCol} || '.' || ${proCol}) = ANY(${textArray(includeFunctions)}))`;
    },
  };
}
