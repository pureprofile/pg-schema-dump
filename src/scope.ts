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

  /** SQL boolean: is a schema in scope (in includeSchemas, or owns >=1 included table)? */
  schemaPredicate(nspCol: string): string;

  /**
   * SQL boolean: was this schema opted into *wholesale* via includeSchemas?
   *
   * Distinct from schemaPredicate, which is also true for a schema merely
   * containing one included table. Objects that belong to a specific table -
   * sequences above all - must use this, or naming a single table pulls in every
   * sequence in its schema.
   */
  includedSchemaPredicate(nspCol: string): string;

  /** SQL boolean for the includeFunctions escape hatch. Returns 'false' when empty. */
  functionPredicate(nspCol: string, proCol: string): string;
}

function textArray(values: string[]): string {
  return `ARRAY[${values.map(pgQuoteString).join(', ')}]::text[]`;
}

function schemaPrefixesOf(includeTables: string[]): string[] {
  const prefixes = includeTables.map((entry) => entry.slice(0, entry.indexOf('.')));
  return Array.from(new Set(prefixes));
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
    schemaPredicate(nspCol: string): string {
      if (!active) {
        return 'true';
      }
      const disjuncts: string[] = [];
      if (includeSchemas.length > 0) {
        disjuncts.push(`${nspCol} = ANY(${textArray(includeSchemas)})`);
      }
      const tableSchemas = schemaPrefixesOf(includeTables);
      if (tableSchemas.length > 0) {
        disjuncts.push(`${nspCol} = ANY(${textArray(tableSchemas)})`);
      }
      if (disjuncts.length === 0) {
        return 'false';
      }
      return `(${disjuncts.join(' OR ')})`;
    },
    functionPredicate(nspCol: string, proCol: string): string {
      if (includeFunctions.length === 0) {
        return 'false';
      }
      return `((${nspCol} || '.' || ${proCol}) = ANY(${textArray(includeFunctions)}))`;
    },
  };
}
