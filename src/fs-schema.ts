import * as fs from 'fs-extra';
import * as path from 'path';
import assert from 'assert';
import autoBind from 'auto-bind';
import { log } from './utils';
import { normalizedSrc, unquoted, quotedIfUnsafe, sortedAttributes } from './fs-schema-helpers';
import { sortBy } from 'lodash';
import { Attribute } from './pg-objects/tables';

export const F_EXTENSION_PREFIX = 'extension.';
export const F_SCHEMA_PREFIX = 'schema.';
export const F_SEQUENCE_PREFIX = 'sequence.';
export const F_TYPE_PREFIX = 'type.';
export const F_TABLE_PREFIX = 'table.';
export const F_FOREIGN_KEY_PREFIX = 'fk.';

export const F_FUNCTION_PREFIX = 'function.';
export const F_INDEX_PREFIX = 'index.';
export const F_TRIGGER_PREFIX = 'trigger.';
export const F_VIEW_PREFIX = 'view.';

export class FsSchema {
  public root: string;

  constructor(root: string, private logger: typeof log | null) {
    this.root = root;
    autoBind(this);
  }

  clean() {
    fs.emptyDirSync(this.root);
  }

  async readDir() {
    const files = await fs.readdir(this.root);
    return sortBy(files, (file) => {
      const checks = [
        file.startsWith(F_EXTENSION_PREFIX),
        file.startsWith(F_SCHEMA_PREFIX),
        file.startsWith(F_SEQUENCE_PREFIX),
        file.startsWith(F_TYPE_PREFIX),
        file.startsWith(F_TABLE_PREFIX),
        file.startsWith(F_FOREIGN_KEY_PREFIX),
      ];
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

  writeExtension(e: { name: string; src: string }) {
    this.outputFileSyncSafe(path.join(this.root, `${F_EXTENSION_PREFIX}${e.name}.sql`), e.src);
    return e;
  }

  writeSchema(s: { schema: string }) {
    const sql = `CREATE SCHEMA IF NOT EXISTS "${s.schema}"`;
    this.outputFileSyncSafe(path.join(this.root, `${F_SCHEMA_PREFIX}${s.schema}.sql`), sql);
    return s;
  }

  writeType(t: { name: string; src: string }) {
    this.outputFileSyncSafe(path.join(this.root, `${F_TYPE_PREFIX}${t.name}.sql`), normalizedSrc(t.src));
    return t;
  }

  writeFunction(f: { schema: string; name: string; src: string }) {
    this.outputFileSyncSafe(
      path.join(this.root, `${F_FUNCTION_PREFIX}${f.schema}.${f.name}.sql`),
      normalizedSrc(f.src)
    );
    return f;
  }

  writeIndex(i: { schema: string; table: string; name: string; src: string }) {
    this.outputFileSyncSafe(path.join(this.root, `${F_INDEX_PREFIX}${i.schema}.${i.table}.${i.name}.sql`), i.src);
    return i;
  }

  writeSequence(s: { schema: string; name: string; src: string }) {
    this.outputFileSyncSafe(path.join(this.root, `${F_SEQUENCE_PREFIX}${s.schema}.${s.name}.sql`), s.src);
    return s;
  }

  writeView(v: { schema: string; name: string; src: string }) {
    this.outputFileSyncSafe(
      path.join(this.root, `${F_VIEW_PREFIX}${v.schema}.${v.name}.sql`),
      `CREATE OR REPLACE VIEW ${v.schema}.${v.name} AS\n${v.src}\n`
    );
    return v;
  }

  writeTrigger(t: { schema: string; table: string; name: string; src: string }) {
    this.outputFileSyncSafe(
      path.join(this.root, `${F_TRIGGER_PREFIX}${t.schema}.${unquoted(t.table)}.${t.name}.sql`),
      `${t.src}\n`
    );
    return t;
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

    const safeName = quotedIfUnsafe(name);
    let refStr = null;
    if (references) {
      // references are handled in separate files, so just comment here
      const colRefStr = references.attribute.isPrimaryKey ? `` : `(${references.attribute.name})`;
      refStr = `/* references ${references.table}${colRefStr} */`;
    }
    return [
      safeName,
      type,
      isNotNull ? 'not null' : null,
      defaultValue ? `default ${defaultValue}` : null,
      isPrimaryKey ? `primary key` : null,
      refStr,
    ]
      .filter((e) => e != null)
      .join(' ');
  }

  writeTable(t: { schema: string; table: string; attributes: Attribute[] }) {
    const { schema, table, attributes } = t;
    this.outputFileSyncSafe(
      path.join(this.root, `${F_TABLE_PREFIX}${schema}.${table}.sql`),
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
    const attrWithReference = attributes.filter((attr) => attr.references);
    for (const attr of attrWithReference) {
      const ref = attr.references!;
      const fkName = quotedIfUnsafe(attr.name + '_fk');
      const sql = `
        ALTER TABLE ${schema}.${table}
        ADD CONSTRAINT ${fkName}
        FOREIGN KEY (${quotedIfUnsafe(attr.name)})
        REFERENCES ${ref.table} ${ref.attribute.isPrimaryKey ? `` : `(${ref.attribute.name})`}
      `
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l)
        .join('\n');
      this.outputFileSyncSafe(path.join(this.root, `${F_FOREIGN_KEY_PREFIX}${schema}.${table}.${fkName}.sql`), sql);
    }
    return t;
  }
}
