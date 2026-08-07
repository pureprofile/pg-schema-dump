import { parse as pgParseArray } from 'postgres-array';

export function pgQuoteString(item: string): string {
  if (typeof item === 'string') {
    return `'${item.replace(/'/g, `''`)}'`;
  }
  return item;
}

export function pgQuoteStrings(arr: string[]): string[] {
  return arr.map(pgQuoteString);
}

export function pgStringArray(input: string): string[] {
  return pgParseArray(input, (item) => item);
}

/**
 * SQL predicate: this object is not owned by an extension.
 *
 * CREATE EXTENSION recreates everything an extension owns, so dumping those
 * objects as well is redundant at best. At worst it fails the restore outright -
 * pg_stat_statements' own view cannot be replayed as plain SQL.
 */
export function notExtensionOwned(classRegclass: string, oidCol: string): string {
  return `NOT EXISTS (
    SELECT 1 FROM pg_depend ed
    WHERE ed.classid = '${classRegclass}'::regclass
      AND ed.objid = ${oidCol}
      AND ed.deptype = 'e'
      AND ed.refclassid = 'pg_extension'::regclass
  )`;
}
