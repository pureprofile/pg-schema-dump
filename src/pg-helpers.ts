import { F_TABLE_PREFIX, F_FUNCTION_PREFIX } from './fs-schema';
import { parse as pgParseArray } from 'postgres-array';

export function all<T>(fn: (arg: T) => T) {
  return (items: T[]) => {
    return items.map(fn);
  };
}

export function pgQuoteString(item: string): string {
  if (typeof item === 'string') {
    return `'${item}'`;
  }
  return item;
}

export function pgQuoteStrings(arr: string[]): string[] {
  return arr.map(pgQuoteString);
}

export function pgStringArray(input: string): string[] {
  return pgParseArray(input, (item) => item);
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
      let retVal = false;
      for (const reference of references) {
        const found = fNames.findIndex((f) => f.startsWith(refPrefix) && f.includes(`.${reference}.`));
        if (found > 0) {
          const removed = fNames.splice(found, 1);
          fNames.unshift(...removed);
          retVal = true;
        }
      }
      return retVal;
    }
  }
  return false;
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
