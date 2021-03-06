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

export function sortedAttributes(attributes: Attribute[]) {
  const head = ['id', 'created_at', 'updated_at', 'deleted_at'];
  return sortBy(attributes, (attribute) => {
    if (head.includes(attribute.name)) {
      return [head.indexOf(attribute.name)];
    }
    return [head.length, attribute.references ? 0 : 1, attribute.name];
  });
}
