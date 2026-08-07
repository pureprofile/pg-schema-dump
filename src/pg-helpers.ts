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
