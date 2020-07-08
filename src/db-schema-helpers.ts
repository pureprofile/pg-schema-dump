export function pgQuoteString(item: string) {
  if (typeof item === 'string') {
    return `'${item}'`;
  }
  return item;
}

export function pgQuoteStrings(arr: string[]) {
  return arr.map(pgQuoteString);
}
