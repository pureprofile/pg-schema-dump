export function pgQuoteString(item: string) {
  if (typeof item === 'string') {
    return `'${item}'`;
  }
  return item;
}

export function pgQuoteStrings(arr: string[]) {
  return arr.map(pgQuoteString);
}

export function pgCreateSchemaSql(schemaName: string) {
  return `CREATE SCHEMA IF NOT EXISTS "${schemaName}"`;
}
