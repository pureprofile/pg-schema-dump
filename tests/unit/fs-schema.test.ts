import * as os from 'node:os';
import * as path from 'node:path';

import * as fs from 'fs-extra';
import { vi } from 'vitest';

import * as fsSchemaModule from '../../src/fs-schema';
import { FsSchema, RESTORE_ORDER } from '../../src/fs-schema';
import type { Attribute } from '../../src/pg-objects/tables';

// RESTORE_ORDER is matched with startsWith, so a prefix missing from it does not error:
// it sorts last and happens to work until something in that bucket genuinely has to be
// restored before something else. Adding a write* method and forgetting to rank its
// prefix is the mistake this catches.
test('every file prefix has a place in RESTORE_ORDER', () => {
  const prefixes = Object.entries(fsSchemaModule)
    .filter(([name, value]) => name.startsWith('F_') && name.endsWith('_PREFIX') && typeof value === 'string')
    .map(([, value]) => value as string);

  expect(prefixes.length).toBeGreaterThan(0);
  expect([...RESTORE_ORDER].toSorted()).toEqual([...prefixes].toSorted());
});

let tmp: string;
let fsSchema: FsSchema;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pgsd-fs-'));
  fsSchema = new FsSchema(tmp, null);
});

afterEach(() => {
  fs.removeSync(tmp);
});

// ---------------------------------------------------------------------------
// clean()
// ---------------------------------------------------------------------------
test('clean() empties the directory', () => {
  fs.outputFileSync(path.join(tmp, 'stray.txt'), 'hello');
  expect(fs.readdirSync(tmp)).toHaveLength(1);
  fsSchema.clean();
  expect(fs.readdirSync(tmp)).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// outputFileSyncSafe collision
// ---------------------------------------------------------------------------
test('outputFileSyncSafe collision: creates versioned files and warns', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const fsSchemaSpy = new FsSchema(tmp, logger);

  const fn = { schema: 'public', name: 'gen_id', src: 'CREATE FUNCTION gen_id() RETURNS uuid AS $$ $$ LANGUAGE sql' };
  fsSchemaSpy.writeFunction(fn);
  fsSchemaSpy.writeFunction(fn);
  fsSchemaSpy.writeFunction(fn);

  expect(fs.existsSync(path.join(tmp, 'function.public.gen_id.sql'))).toBe(true);
  expect(fs.existsSync(path.join(tmp, 'function.public.gen_id.v2.sql'))).toBe(true);
  expect(fs.existsSync(path.join(tmp, 'function.public.gen_id.v3.sql'))).toBe(true);
  expect(logger.warn).toHaveBeenCalledTimes(2);
});

// ---------------------------------------------------------------------------
// writeExtension
// ---------------------------------------------------------------------------
test('writeExtension produces correct filename and content', () => {
  const src = 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"';
  fsSchema.writeExtension({ name: 'uuid-ossp', src });
  const content = fs.readFileSync(path.join(tmp, 'extension.uuid-ossp.sql'), 'utf-8');
  expect(content).toBe(src);
});

// ---------------------------------------------------------------------------
// writeSchema
// ---------------------------------------------------------------------------
test('writeSchema wraps in CREATE SCHEMA IF NOT EXISTS', () => {
  fsSchema.writeSchema({ schema: 'myschema' });
  const content = fs.readFileSync(path.join(tmp, 'schema.myschema.sql'), 'utf-8');
  // Left bare: quoting a plain lowercase name would churn every dump for nothing.
  expect(content).toBe('CREATE SCHEMA IF NOT EXISTS myschema');
});

// A name containing a double quote cannot be exercised here: it goes into the file
// *name* too, which Windows rejects. quoteIdent's quote-doubling is covered directly in
// fs-schema-helpers.test.ts, which is what stops such a name escaping its identifier.
test('writeSchema quotes a mixed-case schema name so it does not fold', () => {
  fsSchema.writeSchema({ schema: 'MixedCase' });
  const content = fs.readFileSync(path.join(tmp, 'schema.MixedCase.sql'), 'utf-8');
  expect(content).toBe('CREATE SCHEMA IF NOT EXISTS "MixedCase"');
});

// ---------------------------------------------------------------------------
// writeType
// ---------------------------------------------------------------------------
test('writeType normalizes CRLF and schema-qualifies the filename', () => {
  const src = "CREATE TYPE public.mood AS ENUM (\r\n  'happy',\r\n  'sad'\r\n)";
  fsSchema.writeType({ schema: 'public', name: 'mood', src });
  const content = fs.readFileSync(path.join(tmp, 'type.public.mood.sql'), 'utf-8');
  expect(content).not.toContain('\r');
  expect(content).toContain('happy');
});

// ---------------------------------------------------------------------------
// writeFunction
// ---------------------------------------------------------------------------
test('writeFunction produces correct prefix and normalizes src', () => {
  const src = 'CREATE FUNCTION public.do_thing()\r\nRETURNS void AS $$ $$ LANGUAGE sql';
  fsSchema.writeFunction({ schema: 'public', name: 'do_thing', src });
  const content = fs.readFileSync(path.join(tmp, 'function.public.do_thing.sql'), 'utf-8');
  expect(content).not.toContain('\r');
  expect(content).toContain('do_thing');
});

// ---------------------------------------------------------------------------
// writeSequence
// ---------------------------------------------------------------------------
test('writeSequence produces correct filename and preserves src', () => {
  const src = 'CREATE SEQUENCE public.users_id_seq START 1';
  fsSchema.writeSequence({ schema: 'public', name: 'users_id_seq', src });
  const content = fs.readFileSync(path.join(tmp, 'sequence.public.users_id_seq.sql'), 'utf-8');
  expect(content).toBe(src);
});

// ---------------------------------------------------------------------------
// writeView
// ---------------------------------------------------------------------------
test('writeView wraps in CREATE OR REPLACE VIEW and uses correct prefix', () => {
  const src = 'SELECT id, name FROM public.users';
  fsSchema.writeView({ schema: 'public', name: 'active_users', src });
  const content = fs.readFileSync(path.join(tmp, 'view.public.active_users.sql'), 'utf-8');
  expect(content).toBe(`CREATE OR REPLACE VIEW public.active_users AS\n${src}\n`);
});

// ---------------------------------------------------------------------------
// attributeSql — sequence defaults are kept verbatim
// ---------------------------------------------------------------------------
// Serial shorthand used to be inferred here, but `bigserial` makes Postgres
// auto-create a sequence that collides with the one the dump already emits.
// Emitting the raw nextval() default instead keeps the two in sync, and behaves
// identically whether or not the sequence name is schema-qualified.
test('attributeSql: nextval default is emitted verbatim, not as serial', () => {
  const result = fsSchema.attributeSql({
    table: 'users',
    name: 'id',
    type: 'bigint',
    defaultValue: "nextval('users_id_seq'::regclass)",
    description: '',
    isPrimaryKey: false,
  });
  expect(result).toBe(`id bigint default nextval('users_id_seq'::regclass)`);
});

test('attributeSql: schema-qualified nextval default is emitted verbatim', () => {
  const result = fsSchema.attributeSql({
    table: 'publisher',
    name: 'id',
    type: 'bigint',
    defaultValue: "nextval('affiliates.publisher_id_seq'::regclass)",
    description: '',
    isPrimaryKey: false,
  });
  expect(result).toBe(`id bigint default nextval('affiliates.publisher_id_seq'::regclass)`);
});

test('attributeSql: a type with no serial equivalent no longer throws', () => {
  const result = fsSchema.attributeSql({
    table: 'users',
    name: 'amount',
    type: 'numeric',
    defaultValue: "nextval('users_amount_seq'::regclass)",
    description: '',
    isPrimaryKey: false,
  });
  expect(result).toContain('numeric');
});

// ---------------------------------------------------------------------------
// attributeSql — references
// ---------------------------------------------------------------------------
test('attributeSql: references non-PK → includes column name', () => {
  const result = fsSchema.attributeSql({
    table: 'orders',
    name: 'city_code',
    type: 'text',
    defaultValue: null,
    description: '',
    isPrimaryKey: false,
    references: {
      table: 'cities',
      attribute: {
        table: 'cities',
        name: 'city_id',
        type: 'integer',
        defaultValue: null,
        description: '',
        isPrimaryKey: false,
      },
    },
  });
  expect(result).toContain('/* references cities(city_id) */');
});

test('attributeSql: references PK → no column name', () => {
  const result = fsSchema.attributeSql({
    table: 'orders',
    name: 'user_id',
    type: 'bigint',
    defaultValue: null,
    description: '',
    isPrimaryKey: false,
    references: {
      table: 'cities',
      attribute: {
        table: 'cities',
        name: 'id',
        type: 'integer',
        defaultValue: null,
        description: '',
        isPrimaryKey: true,
      },
    },
  });
  expect(result).toContain('/* references cities */');
  expect(result).not.toContain('(id)');
});

// ---------------------------------------------------------------------------
// attributeSql — flags
// ---------------------------------------------------------------------------
test('attributeSql: isNotNull → contains "not null"', () => {
  const result = fsSchema.attributeSql({
    table: 'users',
    name: 'email',
    type: 'text',
    defaultValue: null,
    description: '',
    isPrimaryKey: false,
    isNotNull: true,
  });
  expect(result).toContain('not null');
});

test('attributeSql: non-serial defaultValue → contains "default"', () => {
  const result = fsSchema.attributeSql({
    table: 'stats',
    name: 'count',
    type: 'integer',
    defaultValue: '0',
    description: '',
    isPrimaryKey: false,
  });
  expect(result).toContain('default 0');
});

// Primary keys are emitted as named table constraints from pg_get_constraintdef
// (the only form that can express a composite key), so the column definition
// must not also declare one.
test('attributeSql: isPrimaryKey does not emit an inline primary key', () => {
  const result = fsSchema.attributeSql({
    table: 'users',
    name: 'id',
    type: 'uuid',
    defaultValue: null,
    description: '',
    isPrimaryKey: true,
  });
  expect(result).toBe('id uuid');
});

test('attributeSql: unsafe name → quoted', () => {
  const result = fsSchema.attributeSql({
    table: 'reports',
    name: 'order',
    type: 'integer',
    defaultValue: null,
    description: '',
    isPrimaryKey: false,
  });
  expect(result.startsWith('"order"')).toBe(true);
});

// ---------------------------------------------------------------------------
// writeTable
// ---------------------------------------------------------------------------
test('writeTable: creates table file and fk file', () => {
  const attributes: Attribute[] = [
    {
      table: 'orders',
      name: 'id',
      type: 'integer',
      defaultValue: "nextval('orders_id_seq'::regclass)",
      description: '',
      isPrimaryKey: true,
    },
    {
      table: 'orders',
      name: 'created_at',
      type: 'timestamp with time zone',
      defaultValue: null,
      description: '',
      isPrimaryKey: false,
    },
    {
      table: 'orders',
      name: 'city_id',
      type: 'integer',
      defaultValue: null,
      description: '',
      isPrimaryKey: false,
      isNotNull: true,
      references: {
        table: 'cities',
        attribute: {
          table: 'cities',
          name: 'id',
          type: 'integer',
          defaultValue: null,
          description: '',
          isPrimaryKey: true,
        },
      },
    },
    {
      table: 'orders',
      name: 'note',
      type: 'text',
      defaultValue: null,
      description: '',
      isPrimaryKey: false,
    },
  ];

  fsSchema.writeTable({
    schema: 'public',
    table: 'orders',
    attributes,
    constraints: [
      { schema: 'public', table: 'orders', name: 'orders_pkey', type: 'p', def: 'PRIMARY KEY (id)' },
      { schema: 'public', table: 'orders', name: 'orders_note_chk', type: 'c', def: "CHECK (note <> ''::text)" },
    ],
    indexes: [{ src: 'CREATE INDEX IF NOT EXISTS idx_orders_note ON public.orders (note)\n' }],
    triggers: [{ src: 'CREATE TRIGGER trg AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION audit()' }],
    ownedSequences: [
      { schema: 'public', name: 'orders_id_seq', ownedBy: { schema: 'public', table: 'orders', column: 'id' } },
    ],
  });

  const tableContent = fs.readFileSync(path.join(tmp, 'table.public.orders.sql'), 'utf-8');
  expect(tableContent.startsWith('create table public.orders (')).toBe(true);

  // sortedAttributes ordering: id, created_at, city_id (references → higher priority), note
  const colLines = tableContent.split('\n').filter((l) => l.startsWith('  '));
  expect(colLines[0]).toMatch(/id integer default nextval/);
  expect(colLines[1]).toMatch(/created_at/);
  const cityIdx = colLines.findIndex((l) => l.includes('city_id'));
  const noteIdx = colLines.findIndex((l) => l.includes('note '));
  expect(cityIdx).toBeLessThan(noteIdx);

  // constraints are named table constraints inside CREATE TABLE
  expect(tableContent).toContain('constraint orders_pkey PRIMARY KEY (id)');
  expect(tableContent).toContain("constraint orders_note_chk CHECK (note <> ''::text)");

  // sequence ownership, indexes and triggers are merged into the same file, each
  // terminated so the whole file replays as one multi-statement script
  expect(tableContent).toContain('ALTER SEQUENCE public.orders_id_seq OWNED BY public.orders.id;');
  expect(tableContent).toContain('CREATE INDEX IF NOT EXISTS idx_orders_note ON public.orders (note);');
  expect(tableContent).toContain('EXECUTE FUNCTION audit();');
  // no stray files for the merged objects
  expect(fs.readdirSync(tmp).filter((f) => f.startsWith('index.') || f.startsWith('trigger.'))).toEqual([]);
});

test('writeForeignKeys: one file per table holding every foreign key', () => {
  fsSchema.writeForeignKeys({
    schema: 'public',
    table: 'orders',
    constraints: [
      {
        schema: 'public',
        table: 'orders',
        name: 'orders_city_fk',
        type: 'f',
        def: 'FOREIGN KEY (city_id) REFERENCES public.cities(id)',
      },
      {
        schema: 'public',
        table: 'orders',
        name: 'orders_tenant_fk',
        type: 'f',
        def: 'FOREIGN KEY (tenant_id, user_id) REFERENCES public.users(tenant_id, id)',
      },
    ],
  });

  const fkFile = path.join(tmp, 'fk.public.orders.sql');
  expect(fs.existsSync(fkFile)).toBe(true);
  const fkContent = fs.readFileSync(fkFile, 'utf-8');
  expect(fkContent).toContain('ALTER TABLE public.orders ADD CONSTRAINT orders_city_fk FOREIGN KEY (city_id)');
  // multi-column foreign keys survive, which the old per-column derivation could not express
  expect(fkContent).toContain(
    'ALTER TABLE public.orders ADD CONSTRAINT orders_tenant_fk FOREIGN KEY (tenant_id, user_id) REFERENCES public.users(tenant_id, id);'
  );
});

test('writeForeignKeys: writes nothing when a table has no foreign keys', () => {
  fsSchema.writeForeignKeys({ schema: 'public', table: 'orders', constraints: [] });
  expect(fs.readdirSync(tmp)).toEqual([]);
});

// ---------------------------------------------------------------------------
// readDir — ordering by prefix priority
// ---------------------------------------------------------------------------
test('readDir orders files so every dependency is satisfied by an earlier file', async () => {
  const names = [
    'zzz_unprefixed.sql',
    'view.public.v.sql',
    'fk.public.a.sql',
    'table.public.a.sql',
    'function.public.f.sql',
    'sequence.public.a_id_seq.sql',
    'type.public.mood.sql',
    'schema.public.sql',
    'extension.x.sql',
  ];
  for (const name of names) {
    fs.outputFileSync(path.join(tmp, name), '');
  }

  const files = await fsSchema.readDir();

  // extension -> schema -> type -> sequence -> function -> table -> fk -> view
  expect(files).toEqual([
    'extension.x.sql',
    'schema.public.sql',
    'type.public.mood.sql',
    'sequence.public.a_id_seq.sql',
    'function.public.f.sql',
    'table.public.a.sql',
    'fk.public.a.sql',
    'view.public.v.sql',
    'zzz_unprefixed.sql',
  ]);
});

// ---------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------
test('read returns file contents', async () => {
  fs.outputFileSync(path.join(tmp, 'test.sql'), 'SELECT 1');
  const content = await fsSchema.read('test.sql');
  expect(content).toBe('SELECT 1');
});
