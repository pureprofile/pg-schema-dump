import * as fs from 'fs-extra';
import * as path from 'path';
import autoBind from 'auto-bind';
import { log } from './utils';
import { normalizedSrc, quoteIdent, quoteQualified, sortedAttributes, unquoted } from './fs-schema-helpers';
import { sortBy } from 'lodash';
import { Attribute } from './pg-objects/tables';
import { Constraint } from './pg-objects/constraints';
import { OwnedBy } from './pg-objects/sequences';

export const F_EXTENSION_PREFIX = 'extension.';
export const F_SCHEMA_PREFIX = 'schema.';
export const F_TYPE_PREFIX = 'type.';
export const F_SEQUENCE_PREFIX = 'sequence.';
export const F_FUNCTION_PREFIX = 'function.';
export const F_TABLE_PREFIX = 'table.';
export const F_FOREIGN_KEY_PREFIX = 'fk.';
export const F_VIEW_PREFIX = 'view.';

/**
 * Restore order. Every dependency a restored object can have is satisfied by an
 * earlier bucket, so a dump replays in one pass:
 *
 *  - functions come before tables, and are applied with `check_function_bodies`
 *    off, so a function body may reference a table that does not exist yet. That
 *    removes the whole class of forward-reference failures.
 *  - every table is created before any foreign key is added, so foreign key
 *    cycles between tables restore cleanly.
 *  - indexes and triggers are written inside their table's file, which is safe
 *    precisely because functions already exist by then.
 */
export const RESTORE_ORDER = [
  F_EXTENSION_PREFIX,
  F_SCHEMA_PREFIX,
  F_TYPE_PREFIX,
  F_SEQUENCE_PREFIX,
  F_FUNCTION_PREFIX,
  F_TABLE_PREFIX,
  F_FOREIGN_KEY_PREFIX,
  F_VIEW_PREFIX,
];

/** Trim trailing whitespace/semicolons and terminate with exactly one `;`. */
function statementSql(src: string): string {
  return `${normalizedSrc(src).replace(/[\s;]+$/, '')};`;
}

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
      const found = RESTORE_ORDER.findIndex((prefix) => file.startsWith(prefix));
      const num = found === -1 ? RESTORE_ORDER.length : found;
      // pad so bucket 10+ would still sort after bucket 9
      return `${String(num).padStart(2, '0')}-${file}`;
    });
  }

  read(fName: string) {
    return fs.readFile(path.resolve(this.root, fName), 'utf8');
  }

  outputFileSyncSafe(fileName: string, fileExtension: string, content: string) {
    let filePath = `${fileName}.${fileExtension}`;

    if (fs.existsSync(filePath)) {
      // conflict, find a non-existing file name
      let version = 1;
      do {
        version += 1;
        filePath = `${fileName}.v${version}.${fileExtension}`;
      } while (fs.existsSync(filePath));
      this.logger?.warn(`File already exists for folder '${path.basename(this.root)}', using name: ${filePath}`);
    }

    return fs.outputFileSync(filePath, content);
  }

  writeExtension(e: { name: string; src: string }) {
    this.outputFileSyncSafe(path.join(this.root, `${F_EXTENSION_PREFIX}${e.name}`), 'sql', e.src);
    return e;
  }

  writeSchema(s: { schema: string }) {
    // Hand-quoting misses the escaping: a schema legally named `a"b` closes the
    // identifier early, which is malformed at best and a way to append statements to
    // the restore stream at worst. quoteIdent doubles embedded quotes.
    const sql = `CREATE SCHEMA IF NOT EXISTS ${quoteIdent(s.schema)}`;
    this.outputFileSyncSafe(path.join(this.root, `${F_SCHEMA_PREFIX}${s.schema}`), 'sql', sql);
    return s;
  }

  writeType(t: { schema: string; name: string; src: string }) {
    this.outputFileSyncSafe(path.join(this.root, `${F_TYPE_PREFIX}${t.schema}.${t.name}`), 'sql', normalizedSrc(t.src));
    return t;
  }

  writeFunction(f: { schema: string; name: string; src: string }) {
    this.outputFileSyncSafe(
      path.join(this.root, `${F_FUNCTION_PREFIX}${f.schema}.${f.name}`),
      'sql',
      normalizedSrc(f.src)
    );
    return f;
  }

  writeSequence(s: { schema: string; name: string; src: string }) {
    this.outputFileSyncSafe(path.join(this.root, `${F_SEQUENCE_PREFIX}${s.schema}.${s.name}`), 'sql', s.src);
    return s;
  }

  writeView(v: { schema: string; name: string; src: string }) {
    this.outputFileSyncSafe(
      path.join(this.root, `${F_VIEW_PREFIX}${v.schema}.${v.name}`),
      'sql',
      `CREATE OR REPLACE VIEW ${quoteQualified(v.schema, v.name)} AS\n${v.src}\n`
    );
    return v;
  }

  attributeSql({ name, type, isNotNull = false, defaultValue, references }: Attribute): string {
    // A column name sits in a bare identifier position, where a reserved word is a
    // hard syntax error (`create table t (group int)` does not parse) and a
    // mixed-case name silently folds to lowercase. quoteIdent covers every legal
    // name; the short hand-written list this used to consult did not.
    const safeName = quoteIdent(name);
    let refStr = null;
    if (references) {
      // foreign keys live in their own file, so this is only a breadcrumb
      const colRefStr = references.attribute.isPrimaryKey ? `` : `(${references.attribute.name})`;
      refStr = `/* references ${references.table}${colRefStr} */`;
    }
    return [safeName, type, isNotNull ? 'not null' : null, defaultValue ? `default ${defaultValue}` : null, refStr]
      .filter((e) => e != null)
      .join(' ');
  }

  /**
   * One file per table holding everything that belongs to it and cannot be
   * referenced from elsewhere: its columns, its non-foreign-key constraints,
   * ownership of its sequences, its indexes and its triggers. Keeping them
   * together is what holds the file count down on a large schema.
   *
   * Foreign keys are deliberately excluded - they reference other tables, so
   * they have to wait until every table exists. See writeForeignKeys.
   */
  writeTable(t: {
    schema: string;
    table: string;
    attributes: Attribute[];
    constraints?: Constraint[];
    indexes?: Array<{ src: string }>;
    triggers?: Array<{ src: string }>;
    ownedSequences?: Array<{ schema: string; name: string; ownedBy: OwnedBy }>;
  }) {
    const { schema, table, attributes } = t;
    const constraints = t.constraints || [];
    const indexes = t.indexes || [];
    const triggers = t.triggers || [];
    const ownedSequences = t.ownedSequences || [];

    const columnSql = sortedAttributes(attributes).map((attribute) => this.attributeSql({ ...attribute, table }));
    // pg_get_constraintdef already produced the definition, so it just needs naming
    const constraintSql = constraints.map((c) => `constraint ${quoteIdent(c.name)} ${c.def}`);

    // The identifier is quoted but the file name is not: a reserved word survives
    // unquoted here (`public.user` parses, because the qualification disambiguates
    // it), but a mixed-case or punctuated name would silently fold to lowercase.
    const statements = [
      [
        `create table ${quoteQualified(schema, unquoted(table))} (`,
        columnSql
          .concat(constraintSql)
          .map((e) => `  ${e}`)
          .join(',\n'),
        ');',
      ].join('\n'),
    ];
    // Each group is sorted on the text about to be written. The collectors already
    // order deterministically (by name, which is unique per table), so this is not
    // load-bearing today - it keys the file's contents on the file's contents, so a
    // later change to a collector's ORDER BY cannot silently reshuffle a dump that is
    // meant to be diffed against its predecessor.
    for (const sequence of sortBy(ownedSequences, (seq) => `${seq.schema}.${seq.name}`)) {
      const owner = `${quoteQualified(sequence.ownedBy.schema, sequence.ownedBy.table)}.${quoteIdent(
        sequence.ownedBy.column
      )}`;
      statements.push(`ALTER SEQUENCE ${quoteQualified(sequence.schema, sequence.name)} OWNED BY ${owner};`);
    }
    for (const index of sortBy(indexes, (idx) => idx.src)) {
      statements.push(statementSql(index.src));
    }
    for (const trigger of sortBy(triggers, (trg) => trg.src)) {
      statements.push(statementSql(trigger.src));
    }

    this.outputFileSyncSafe(
      path.join(this.root, `${F_TABLE_PREFIX}${schema}.${table}`),
      'sql',
      `${statements.join('\n\n')}\n`
    );
    return t;
  }

  /** All of one table's foreign keys, applied once every table exists. */
  writeForeignKeys(t: { schema: string; table: string; constraints: Constraint[] }) {
    if (t.constraints.length === 0) {
      return t;
    }
    const sql = t.constraints
      .map(
        (c) =>
          `ALTER TABLE ${quoteQualified(t.schema, unquoted(t.table))} ADD CONSTRAINT ${quoteIdent(c.name)} ${c.def};`
      )
      .join('\n');
    this.outputFileSyncSafe(
      path.join(this.root, `${F_FOREIGN_KEY_PREFIX}${t.schema}.${unquoted(t.table)}`),
      'sql',
      `${sql}\n`
    );
    return t;
  }
}
