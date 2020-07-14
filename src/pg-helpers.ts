import { F_TABLE_PREFIX, F_FUNCTION_PREFIX } from './fs-schema';
import { unquoted } from './fs-schema-helpers';

export function pgQuoteString(item: string) {
  if (typeof item === 'string') {
    return `'${item}'`;
  }
  return item;
}

export function pgQuoteStrings(arr: string[]) {
  return arr.map(pgQuoteString);
}

export function pgCreateExtensionSql(name: string) {
  return `CREATE EXTENSION IF NOT EXISTS "${name}"`;
}

export function pgCreateSchemaSql(schemaName: string) {
  return `CREATE SCHEMA IF NOT EXISTS "${schemaName}"`;
}

export function sqlGetTableReferences(tableSql: string): string[] {
  const re = new RegExp(/references\s+([".\w]+)/i);
  const matches = tableSql.match(new RegExp(re, 'g'));
  if (!matches) {
    return [];
  }
  return matches.map((str) => {
    const m = re.exec(str);
    const candidate = m![1];
    const parts = candidate.split('.');
    return parts.map((p) => unquoted(p)).join('.');
  });
}

const PG_BUILTIN_FUNCTIONS = ['now', 'NOW', 'nextval', 'NEXTVAL'];

export function sqlGetFunctionReferences(tableSql: string): string[] {
  const matches = tableSql.match(/default\s+(\w+)\(/gi);
  if (!matches) {
    return [];
  }
  const fns = matches.map((str) => {
    const m = /default\s+(\w+)\(/i.exec(str);
    return m![1];
  });
  return fns.reduce((arr, fn) => {
    if (!PG_BUILTIN_FUNCTIONS.includes(fn)) {
      arr.push(fn);
    }
    return arr;
  }, [] as string[]);
}

function findAndShift({
  fName,
  fContents,
  fNames,
  refFn,
  refPrefix,
}: {
  fName: string;
  fContents: string;
  fNames: string[];
  refFn: (sql: string) => string[];
  refPrefix: string;
}): boolean {
  if (fName.startsWith(F_TABLE_PREFIX)) {
    const references = refFn(fContents);
    if (references.length > 0) {
      const found = fNames.findIndex((f) => f.startsWith(refPrefix) && f.includes(`.${references[0]}.`));
      if (found > 0) {
        const removed = fNames.splice(found, 1);
        fNames.unshift(...removed);
        return true;
      }
    }
  }
  return false;
}

export function findAndShiftTableReferences(fName: string, fContents: string, fNames: string[]): boolean {
  return findAndShift({
    fName,
    fNames,
    fContents,
    refFn: sqlGetTableReferences,
    refPrefix: F_TABLE_PREFIX,
  });
}

export function findAndShiftFunctionReferences(fName: string, fContents: string, fNames: string[]): boolean {
  return findAndShift({
    fName,
    fNames,
    fContents,
    refFn: sqlGetFunctionReferences,
    refPrefix: F_FUNCTION_PREFIX,
  });
}
