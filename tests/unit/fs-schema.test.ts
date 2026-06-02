import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { vi } from 'vitest';
import { FsSchema } from '../../src/fs-schema';
import type { Attribute } from '../../src/pg-objects/tables';

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
  const content = fs.readFileSync(path.join(tmp, 'extension.uuid-ossp.sql'), 'utf8');
  expect(content).toBe(src);
});

// ---------------------------------------------------------------------------
// writeSchema
// ---------------------------------------------------------------------------
test('writeSchema wraps in CREATE SCHEMA IF NOT EXISTS', () => {
  fsSchema.writeSchema({ schema: 'myschema' });
  const content = fs.readFileSync(path.join(tmp, 'schema.myschema.sql'), 'utf8');
  expect(content).toBe('CREATE SCHEMA IF NOT EXISTS "myschema"');
});

// ---------------------------------------------------------------------------
// writeType
// ---------------------------------------------------------------------------
test('writeType normalizes CRLF and writes correct prefix', () => {
  const src = "CREATE TYPE mood AS ENUM (\r\n  'happy',\r\n  'sad'\r\n)";
  fsSchema.writeType({ name: 'mood', src });
  const content = fs.readFileSync(path.join(tmp, 'type.mood.sql'), 'utf8');
  expect(content).not.toContain('\r');
  expect(content).toContain('happy');
});

// ---------------------------------------------------------------------------
// writeFunction
// ---------------------------------------------------------------------------
test('writeFunction produces correct prefix and normalizes src', () => {
  const src = 'CREATE FUNCTION public.do_thing()\r\nRETURNS void AS $$ $$ LANGUAGE sql';
  fsSchema.writeFunction({ schema: 'public', name: 'do_thing', src });
  const content = fs.readFileSync(path.join(tmp, 'function.public.do_thing.sql'), 'utf8');
  expect(content).not.toContain('\r');
  expect(content).toContain('do_thing');
});

// ---------------------------------------------------------------------------
// writeIndex
// ---------------------------------------------------------------------------
test('writeIndex produces correct filename and preserves src', () => {
  const src = 'CREATE INDEX idx_users_email ON public.users (email)';
  fsSchema.writeIndex({ schema: 'public', table: 'users', name: 'idx_users_email', src });
  const content = fs.readFileSync(path.join(tmp, 'index.public.users.idx_users_email.sql'), 'utf8');
  expect(content).toBe(src);
});

// ---------------------------------------------------------------------------
// writeSequence
// ---------------------------------------------------------------------------
test('writeSequence produces correct filename and preserves src', () => {
  const src = 'CREATE SEQUENCE public.users_id_seq START 1';
  fsSchema.writeSequence({ schema: 'public', name: 'users_id_seq', src });
  const content = fs.readFileSync(path.join(tmp, 'sequence.public.users_id_seq.sql'), 'utf8');
  expect(content).toBe(src);
});

// ---------------------------------------------------------------------------
// writeView
// ---------------------------------------------------------------------------
test('writeView wraps in CREATE OR REPLACE VIEW and uses correct prefix', () => {
  const src = 'SELECT id, name FROM public.users';
  fsSchema.writeView({ schema: 'public', name: 'active_users', src });
  const content = fs.readFileSync(path.join(tmp, 'view.public.active_users.sql'), 'utf8');
  expect(content).toBe(`CREATE OR REPLACE VIEW public.active_users AS\n${src}\n`);
});

// ---------------------------------------------------------------------------
// writeTrigger — unquotes table name in filename
// ---------------------------------------------------------------------------
test('writeTrigger uses unquoted table name in filename', () => {
  const src = 'CREATE TRIGGER trg_audit AFTER INSERT ON "my_table" FOR EACH ROW EXECUTE PROCEDURE audit()';
  fsSchema.writeTrigger({ schema: 'public', table: '"my_table"', name: 'trg_audit', src });
  // filename should use unquoted form: trigger.public.my_table.trg_audit.sql
  expect(fs.existsSync(path.join(tmp, 'trigger.public.my_table.trg_audit.sql'))).toBe(true);
  const content = fs.readFileSync(path.join(tmp, 'trigger.public.my_table.trg_audit.sql'), 'utf8');
  expect(content).toBe(`${src}\n`);
});

// ---------------------------------------------------------------------------
// attributeSql — serial mapping
// ---------------------------------------------------------------------------
test('attributeSql: integer + nextval seq → serial', () => {
  const result = fsSchema.attributeSql({
    table: 'users',
    name: 'id',
    type: 'integer',
    defaultValue: "nextval('users_id_seq'::regclass)",
    description: '',
    isPrimaryKey: false,
  });
  expect(result).toBe('id serial');
});

test('attributeSql: smallint + nextval seq → smallserial', () => {
  const result = fsSchema.attributeSql({
    table: 'users',
    name: 'count',
    type: 'smallint',
    defaultValue: "nextval('users_count_seq'::regclass)",
    description: '',
    isPrimaryKey: false,
  });
  // "count" is a keyword so it gets quoted
  expect(result).toBe('"count" smallserial');
});

test('attributeSql: bigint + nextval seq → bigserial', () => {
  const result = fsSchema.attributeSql({
    table: 'events',
    name: 'event_id',
    type: 'bigint',
    defaultValue: "nextval('events_event_id_seq'::regclass)",
    description: '',
    isPrimaryKey: false,
  });
  expect(result).toBe('event_id bigserial');
});

test('attributeSql: numeric + nextval seq → throws (no serial mapping)', () => {
  expect(() =>
    fsSchema.attributeSql({
      table: 'users',
      name: 'amount',
      type: 'numeric',
      defaultValue: "nextval('users_amount_seq'::regclass)",
      description: '',
      isPrimaryKey: false,
    })
  ).toThrow();
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

test('attributeSql: isPrimaryKey → contains "primary key"', () => {
  const result = fsSchema.attributeSql({
    table: 'users',
    name: 'id',
    type: 'uuid',
    defaultValue: null,
    description: '',
    isPrimaryKey: true,
  });
  expect(result).toContain('primary key');
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

  fsSchema.writeTable({ schema: 'public', table: 'orders', attributes });

  // Table file exists and starts correctly
  const tableContent = fs.readFileSync(path.join(tmp, 'table.public.orders.sql'), 'utf8');
  expect(tableContent.startsWith('create table public.orders (')).toBe(true);

  // sortedAttributes ordering: id, created_at, city_id (references → higher priority), note
  const lines = tableContent.split('\n');
  const colLines = lines.filter((l) => l.startsWith('  '));
  expect(colLines[0]).toMatch(/id serial/);
  expect(colLines[1]).toMatch(/created_at/);
  // city_id has references so it comes before note
  const cityIdx = colLines.findIndex((l) => l.includes('city_id'));
  const noteIdx = colLines.findIndex((l) => l.includes('note'));
  expect(cityIdx).toBeLessThan(noteIdx);

  // FK file exists with double .sql extension (that's how writeTable calls outputFileSyncSafe)
  const fkFile = path.join(tmp, 'fk.public.orders.city_id_fk.sql.sql');
  expect(fs.existsSync(fkFile)).toBe(true);
  const fkContent = fs.readFileSync(fkFile, 'utf8');
  expect(fkContent).toContain('ALTER TABLE public.orders');
  expect(fkContent).toContain('ADD CONSTRAINT');
  expect(fkContent).toContain('FOREIGN KEY');
  expect(fkContent).toContain('REFERENCES');
});

// ---------------------------------------------------------------------------
// readDir — ordering by prefix priority
// ---------------------------------------------------------------------------
test('readDir returns files sorted by prefix priority', async () => {
  fs.outputFileSync(path.join(tmp, 'zzz_unprefixed.sql'), '');
  fs.outputFileSync(path.join(tmp, 'table.public.a.sql'), '');
  fs.outputFileSync(path.join(tmp, 'fk.public.a.x_fk.sql'), '');
  fs.outputFileSync(path.join(tmp, 'schema.public.sql'), '');
  fs.outputFileSync(path.join(tmp, 'extension.x.sql'), '');

  const files = await fsSchema.readDir();

  const ext = files.findIndex((f) => f === 'extension.x.sql');
  const sch = files.findIndex((f) => f === 'schema.public.sql');
  const tbl = files.findIndex((f) => f === 'table.public.a.sql');
  const fk = files.findIndex((f) => f === 'fk.public.a.x_fk.sql');
  const zzz = files.findIndex((f) => f === 'zzz_unprefixed.sql');

  expect(ext).toBeLessThan(sch);
  expect(sch).toBeLessThan(tbl);
  expect(tbl).toBeLessThan(fk);
  expect(fk).toBeLessThan(zzz);
});

// ---------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------
test('read returns file contents', async () => {
  fs.outputFileSync(path.join(tmp, 'test.sql'), 'SELECT 1');
  const content = await fsSchema.read('test.sql');
  expect(content).toBe('SELECT 1');
});
