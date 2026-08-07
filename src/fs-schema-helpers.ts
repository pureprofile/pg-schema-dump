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
 * Postgres words that cannot be a bare identifier.
 *
 * The reserved and type/function-name-reserved categories from the Postgres
 * grammar (`pg_get_keywords()` catcode 'R' and 'T'). The unreserved and
 * col-name-keyword categories are omitted deliberately: those are legal bare
 * identifiers, and quoting them would churn every dump for no benefit.
 */
const ReservedWords = new Set(
  `all analyse analyze and any array as asc asymmetric authorization between bigint binary bit
   boolean both case cast char character check coalesce collate collation column concurrently
   constraint create cross current_catalog current_date current_role current_schema current_time
   current_timestamp current_user dec decimal default deferrable desc distinct do else end except
   exists extract false fetch float for foreign freeze from full grant greatest group grouping
   having ilike in initially inner inout int integer intersect interval into is isnull join json
   json_array json_arrayagg json_object json_objectagg lateral leading least left like limit
   localtime localtimestamp national natural nchar none normalize not notnull null nullif numeric
   offset on only or order out outer overlaps overlay placing position precision primary real
   references returning right row select session_user setof similar smallint some substring
   symmetric table tablesample then time timestamp to trailing treat trim true union unique user
   using values varchar variadic verbose when where window with xmlattributes xmlconcat xmlelement
   xmlexists xmlforest xmlnamespaces xmlparse xmlpi xmlroot xmlserialize xmltable`
    .split(/\s+/)
    .filter(Boolean)
);

/**
 * Quotes an identifier the way Postgres itself does.
 *
 * Unlike `quotedIfUnsafe`, which only covers a short hand-written list, this is
 * safe for every legal identifier: anything that is not a bare lowercase
 * `[a-z_][a-z0-9_$]*`, or that collides with a reserved word, gets double-quoted,
 * and embedded double quotes are doubled.
 *
 * Use it for any identifier read out of the catalog. A constraint named
 * `"Order-Key"` produces broken SQL otherwise, one named `select` produces broken
 * SQL in the positions where a bare identifier is required, and one containing a
 * quote character could break out of its own literal.
 */
export function quoteIdent(value: string) {
  if (/^[a-z_][a-z0-9_$]*$/.test(value) && !ReservedWords.has(value)) {
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
