import * as fs from 'fs-extra';
import * as path from 'path';
import assert from 'assert';
import { log } from './utils';
import { Attribute } from './types';
import { normalizedSrc, unquoted, quotedIfKeyword, sortedAttributes } from './fs-schema-helpers';
import { pgCreateSchemaSql } from './pg-helpers';
import { sortBy } from 'lodash';

const SCHEMA_PREFIX = '$schema';
const SEQUENCE_PREFIX = 'sequence';
const TABLE_PREFIX = 'table';

export class FsSchema {
  public root: string;

  constructor(root: string, private logger: typeof log | null) {
    this.root = root;
  }

  clean() {
    fs.emptyDirSync(this.root);
  }

  async readDir() {
    const files = await fs.readdir(this.root);
    return sortBy(files, (file) => {
      const parts = file.split('.');
      const checks = [parts[0] === SCHEMA_PREFIX, parts[1] === SEQUENCE_PREFIX, parts[1] === TABLE_PREFIX];
      const num = checks.indexOf(true) !== -1 ? checks.indexOf(true) : checks.length;
      return `${num}-${file}`;
    });
  }

  read(fName: string) {
    return fs.readFile(path.resolve(this.root, fName), 'utf8');
  }

  outputFileSyncSafe(filePath: string, content: string) {
    if (!fs.existsSync(filePath)) {
      return fs.outputFileSync(filePath, content);
    }

    // conflict
    this.logger?.warn(`File already exists for db '${path.basename(this.root)}': ${filePath}`);

    let version = 1;
    do {
      version += 1;
    } while (fs.existsSync(`${filePath}_v${version}`));

    return fs.outputFileSync(`${filePath}_v${version}`, content);
  }

  writeSchema({ schema }: { schema: string }) {
    this.outputFileSyncSafe(path.join(this.root, `${SCHEMA_PREFIX}.${schema}.sql`), pgCreateSchemaSql(schema));
  }

  writeFunction({ schema, name, src }: { schema: string; name: string; src: string }) {
    this.outputFileSyncSafe(path.join(this.root, `${schema}.function.${name}.sql`), normalizedSrc(src));
  }

  writeIndex({ schema, table, name, src }: { schema: string; table: string; name: string; src: string }) {
    this.outputFileSyncSafe(path.join(this.root, `${schema}.index.${table}.${name}.sql`), src);
  }

  writeSequence({ schema, name, src }: { schema: string; name: string; src: string }) {
    this.outputFileSyncSafe(path.join(this.root, `${schema}.${SEQUENCE_PREFIX}.${name}.sql`), src);
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
      path.join(this.root, `${schema}.${TABLE_PREFIX}.${table}.sql`),
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
