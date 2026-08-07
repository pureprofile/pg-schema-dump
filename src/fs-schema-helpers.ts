import { sortBy } from 'lodash';
import { Attribute } from './pg-objects/tables';

export function normalizedSrc(src: string) {
  if (typeof src !== 'string') {
    return src;
  }
  return src.replace(/\r\n/g, '\n').replace(/\n\r/g, '\n').replace(/\r/g, '\n').replace(/\t/g, '  ');
}

export function unquoted(value: string) {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.substring(1, value.length - 1);
  }
  return value;
}

const Keywords = ['count', 'end', 'from', 'limit', 'line', 'uuid', 'order'];

export function quotedIfUnsafe(value: string) {
  if (value.includes('?') || Keywords.includes(value.toLowerCase())) {
    return `"${value}"`;
  }
  return value;
}

/**
 * Quotes an identifier the way Postgres itself does.
 *
 * Unlike `quotedIfUnsafe`, which only covers a hand-written keyword list, this is
 * safe for every legal identifier: anything outside a bare lowercase
 * `[a-z_][a-z0-9_$]*` gets double-quoted, and embedded double quotes are doubled.
 * Use it for any identifier read out of the catalog — a constraint named
 * `"Order-Key"` produces broken SQL otherwise, and an identifier containing a
 * quote character could otherwise break out of its own literal.
 */
export function quoteIdent(value: string) {
  if (/^[a-z_][a-z0-9_$]*$/.test(value) && !Keywords.includes(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

/** Quotes a `schema.name` pair, quoting each part independently. */
export function quoteQualified(schema: string, name: string) {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`;
}

export function sortedAttributes(attributes: Attribute[]) {
  const head = ['id', 'created_at', 'updated_at', 'deleted_at'];
  return sortBy(attributes, (attribute) => {
    if (head.includes(attribute.name)) {
      return [head.indexOf(attribute.name)];
    }
    return [head.length, attribute.references ? 0 : 1, attribute.name];
  });
}
