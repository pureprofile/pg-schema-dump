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

/**
 * A Postgres array column as a JS array.
 *
 * Also accepts a value node-postgres has already parsed for us. Whether it parses is a
 * detail of the *query*, not of this function: `array_agg(enumlabel)` yields `name[]`
 * (oid 1003, which has no registered parser, so a raw `{a,b}` string arrives here),
 * while the same aggregate over a `text` column yields `text[]` (oid 1009, parsed into
 * a real array). Handing the array parser an array silently returns `[]`, so without
 * this guard adding a cast to a query could quietly empty part of a dump.
 */
export function pgStringArray(input: string | string[]): string[] {
  if (Array.isArray(input)) {
    return input;
  }
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
