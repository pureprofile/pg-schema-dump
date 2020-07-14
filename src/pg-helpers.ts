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

export function sqlGetTableReferences(tableSql: string): string[] {
  const matches = tableSql.match(/references\s+(\w+)/gi);
  if (!matches) {
    return [];
  }
  return matches.map((str) => {
    const m = /references\s+(\w+)/i.exec(str);
    return m![1];
  });
}
