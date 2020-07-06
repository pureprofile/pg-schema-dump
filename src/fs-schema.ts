import * as fs from 'fs-extra';
import * as path from 'path';
import assert from 'assert';
import { isString, sortBy } from 'lodash';
import { logWarn } from './utils';
import { Attribute } from './types';

export class FsSchema {
  public root: string;

  constructor(root: string) {
    this.root = root;
  }

  clean() {
    fs.emptyDirSync(this.root);
  }

  outputFileSyncSafe(filePath: string, content: string) {
    if (!fs.existsSync(filePath)) {
      return fs.outputFileSync(filePath, content);
    }

    // conflict
    logWarn(`File already exists for db '${path.basename(this.root)}': ${filePath}`);

    let version = 1;
    do {
      version += 1;
    } while (fs.existsSync(`${filePath}_v${version}`));

    return fs.outputFileSync(`${filePath}_v${version}`, content);
  }

  writeFunction({ schema, name, src }: { schema: string; name: string; src: string }) {
    this.outputFileSyncSafe(path.join(this.root, `${schema}.function.${name}.sql`), normalizedSrc(src));
  }

  writeIndex({ schema, table, name, src }: { schema: string; table: string; name: string; src: string }) {
    this.outputFileSyncSafe(path.join(this.root, `${schema}.index.${table}.${name}.sql`), src);
  }

  writeView({ schema, name, src }: { schema: string; name: string; src: string }) {
    this.outputFileSyncSafe(
      path.join(this.root, `${schema}.view.${name}.sql`),
      `CREATE OR REPLACE VIEW ${schema}.${name} AS\n${src}\n`
    );
  }

  writeTrigger({ schema, table, name, src }: { schema: string; table: string; name: string; src: string }) {
    this.outputFileSyncSafe(path.join(this.root, `${schema}.trigger.${unquoted(table)}.${name}.sql`), `${src}\n`);
  }

  attributeSql({
    table,
    name,
    type,
    isNotNull = false,
    defaultValue,
    description,
    references,
    isPrimaryKey,
  }: Attribute): string {
    // If it's serial, map to serial shorthand definition.
    if (defaultValue === `nextval('${table}_${name}_seq'::regclass)`) {
      const serialType = ({
        smallint: 'smallserial',
        integer: 'serial',
        bigint: 'bigserial',
      } as { [key: string]: string })[type];
      assert(serialType, `Serial mapping not found for ${type}.`);
      return this.attributeSql({
        table,
        name,
        type: serialType,
        defaultValue: null,
        description,
        references,
        isPrimaryKey,
      });
    }

    const safeName = quotedIfKeyword(name);
    return [
      safeName,
      type,
      isNotNull ? 'not null' : null,
      defaultValue ? `default ${defaultValue}` : null,
      isPrimaryKey ? `primary key` : null,
      references
        ? `references ${references.table}${references.attribute.isPrimaryKey ? '' : `(${references.attribute.name})`}`
        : null,
    ]
      .filter((e) => e != null)
      .join(' ');
  }

  writeTable({ schema, table, attributes }: { schema: string; table: string; attributes: Attribute[] }) {
    this.outputFileSyncSafe(
      path.join(this.root, `${schema}.table.${table}.sql`),
      [
        `create table ${schema}.${table} (`,
        sortedAttributes(attributes)
          .map((attribute) =>
            this.attributeSql({
              ...attribute,
              table,
            })
          )
          .map((e) => `  ${e}`)
          .join(',\n'),
        ');\n',
      ].join('\n')
    );
  }
}

function normalizedSrc(src: string) {
  if (!isString(src)) {
    return src;
  }
  return src.replace(/\r\n/g, '\n').replace(/\n\r/g, '\n').replace(/\r/g, '\n').replace(/\t/g, '  ');
}

function unquoted(value: string) {
  if (value.startsWith('"')) {
    return value.substring(1, value.length - 1);
  }
  return value;
}

const Keywords = ['count', 'end', 'from', 'limit', 'line', 'uuid'];

function quotedIfKeyword(value: string) {
  if (Keywords.includes(value.toLowerCase())) {
    return `"${value}"`;
  }
  return value;
}

function sortedAttributes(attributes: Attribute[]) {
  const head = ['id', 'created_at', 'updated_at', 'deleted_at'];
  return sortBy(attributes, (attribute) => {
    if (head.includes(attribute.name)) {
      return [head.indexOf(attribute.name)];
    }
    return [head.length, attribute.references ? 0 : 1, attribute.name];
  });
}
