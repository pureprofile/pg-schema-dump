import { Client } from 'pg';

import { PgClient } from '../../src/pg-client';
import { collectExtensions } from '../../src/pg-objects/extensions';
import { collectFunctions } from '../../src/pg-objects/functions';
import { collectIndexes } from '../../src/pg-objects/indexes';
import { collectSequences } from '../../src/pg-objects/sequences';
import { collectTables } from '../../src/pg-objects/tables';
import { collectTriggers } from '../../src/pg-objects/triggers';
import { collectTypes } from '../../src/pg-objects/types';
import { collectViews } from '../../src/pg-objects/views';

const COLLECTORS_DB = 'pgsd-collectors';

const host = process.env.TEST_DB_HOST!;
const port = Number(process.env.TEST_DB_PORT);
const user = process.env.TEST_DB_USER!;
const password = process.env.TEST_DB_PASSWORD!;

let raw: Client;

beforeAll(async () => {
  // Create and populate DB via PgClient.
  const admin = new PgClient({ host, port, user, password }, { logger: null });
  await admin.ensureEmptyDb(COLLECTORS_DB);

  await admin.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
  await admin.query(`CREATE TYPE mood AS ENUM ('happy', 'sad')`);
  await admin.query(`CREATE SEQUENCE my_seq INCREMENT 1 MINVALUE 1 MAXVALUE 1000`);
  await admin.query(
    `CREATE TABLE parent (id serial primary key, created_at timestamptz default now(), name text not null)`
  );
  await admin.query(
    `CREATE TABLE child (id bigserial primary key, parent_id integer references parent(id), "order" integer)`
  );
  await admin.query(`CREATE INDEX idx_child_parent ON child (parent_id)`);
  await admin.query(`CREATE VIEW parent_names AS SELECT id, name FROM parent`);
  await admin.query(`CREATE FUNCTION bump_updated() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await admin.query(`CREATE TRIGGER trg_child BEFORE UPDATE ON child FOR EACH ROW EXECUTE FUNCTION bump_updated()`);
  await admin.end();

  // Open a raw pg.Client connected to the populated DB.
  raw = new Client({ host, port, user, password, database: COLLECTORS_DB });
  await raw.connect();
});

afterAll(async () => {
  await raw.end();

  const admin = new PgClient({ host, port, user, password }, { logger: null });
  try {
    await admin.switchDatabase('postgres');
    await admin.dropDatabase(COLLECTORS_DB);
  } catch {
    // ignore
  } finally {
    await admin.end();
  }
});

test('collectExtensions returns an array (may include pgcrypto)', async () => {
  const rows = await collectExtensions(raw);
  expect(Array.isArray(rows)).toBe(true);
  const names = rows.map((r) => r.name);
  expect(names).toContain('pgcrypto');
});

test('collectTypes returns mood enum, schema-qualified with ordered values', async () => {
  const rows = await collectTypes(raw);
  const mood = rows.find((r) => r.name === 'mood');
  expect(mood).toBeDefined();
  expect(mood!.schema).toBe('public');
  expect(mood!.src.toUpperCase()).toContain('ENUM');
  // identifiers are only quoted when they need it, as Postgres itself does
  expect(mood!.src).toContain('CREATE TYPE public.mood');
  expect(mood!.src.indexOf('happy')).toBeLessThan(mood!.src.indexOf('sad'));
});

test('collectSequences returns my_seq with CREATE SEQUENCE src including START/CYCLE, no ownedBy', async () => {
  const rows = await collectSequences(raw);
  const seq = rows.find((r) => r.name === 'my_seq');
  expect(seq).toBeDefined();
  expect(seq!.src.toUpperCase()).toContain('CREATE SEQUENCE');
  expect(seq!.src.toUpperCase()).toContain('START');
  expect(seq!.src.toUpperCase()).toContain('NO CYCLE');
  expect(seq!.ownedBy).toBeNull();
});

test('collectSequences reports ownership separately from the CREATE statement', async () => {
  const rows = await collectSequences(raw);
  const seq = rows.find((r) => r.name === 'parent_id_seq');
  expect(seq).toBeDefined();
  // Three fields, not a dotted string: any identifier may legally contain a dot, so
  // flattening and re-splitting would attach the sequence to the wrong table.
  expect(seq!.ownedBy).toEqual({ schema: 'public', table: 'parent', column: 'id' });
  // The ALTER SEQUENCE ... OWNED BY belongs in the owning table's file, not here:
  // it cannot run before that table exists, and a multi-statement file runs in a
  // single implicit transaction, so a failing ALTER would roll back the CREATE too.
  expect(seq!.src).not.toContain('OWNED BY');
  expect(seq!.src.toUpperCase()).toContain('CREATE SEQUENCE');
});

test('collectTables with skipSchemas:[] returns parent and child with FK reference', async () => {
  const rows = await collectTables(raw, { skipSchemas: [] });
  const names = rows.map((r) => r.table);
  expect(names).toContain('parent');
  expect(names).toContain('child');

  const child = rows.find((r) => r.table === 'child')!;
  const hasRef = child.attributes.some((a) => a.references != null);
  expect(hasRef).toBe(true);
});

test('collectTables with non-empty skipSchemas still returns parent and child', async () => {
  const rows = await collectTables(raw, { skipSchemas: ['pg_catalog', 'information_schema'] });
  const names = rows.map((r) => r.table);
  expect(names).toContain('parent');
  expect(names).toContain('child');
});

test('collectIndexes with skipSchemas:[] contains idx_child_parent with IF NOT EXISTS', async () => {
  const rows = await collectIndexes(raw, { skipSchemas: [] });
  const idx = rows.find((r) => r.name === 'idx_child_parent');
  expect(idx).toBeDefined();
  expect(idx!.src.toUpperCase()).toContain('IF NOT EXISTS');
});

test('collectIndexes with non-empty skipSchemas still contains idx_child_parent', async () => {
  const rows = await collectIndexes(raw, { skipSchemas: ['pg_catalog'] });
  const names = rows.map((r) => r.name);
  expect(names).toContain('idx_child_parent');
});

test('collectIndexes excludes constraint-backed indexes (e.g. parent_pkey)', async () => {
  const rows = await collectIndexes(raw, { skipSchemas: [] });
  const names = rows.map((r) => r.name);
  expect(names).not.toContain('parent_pkey');
  expect(names).not.toContain('child_pkey');
});

test('collectViews with skipSchemas:[] contains parent_names', async () => {
  const { views: rows } = await collectViews(raw, { skipSchemas: [] });
  const names = rows.map((r) => r.name);
  expect(names).toContain('parent_names');
});

test('collectViews with non-empty skipSchemas still contains parent_names', async () => {
  const { views: rows } = await collectViews(raw, { skipSchemas: ['pg_catalog', 'information_schema'] });
  const names = rows.map((r) => r.name);
  expect(names).toContain('parent_names');
});

test('collectTriggers with skipSchemas:[] contains trg_child', async () => {
  const rows = await collectTriggers(raw, { skipSchemas: [] });
  const names = rows.map((r) => r.name);
  expect(names).toContain('trg_child');
});

test('collectTriggers with non-empty skipSchemas still contains trg_child', async () => {
  const rows = await collectTriggers(raw, { skipSchemas: ['pg_catalog', 'information_schema'] });
  const names = rows.map((r) => r.name);
  expect(names).toContain('trg_child');
});

test('collectFunctions with skipSchemas:[] and skipFunctions:[] contains bump_updated', async () => {
  const rows = await collectFunctions(raw, { skipSchemas: [], skipFunctions: [] });
  const names = rows.map((r) => r.name);
  expect(names).toContain('bump_updated');
});

test('collectFunctions with non-empty skipSchemas/skipFunctions contains bump_updated', async () => {
  const rows = await collectFunctions(raw, {
    skipSchemas: ['pg_catalog', 'information_schema'],
    skipFunctions: ['nonexistent_fn'],
  });
  const names = rows.map((r) => r.name);
  expect(names).toContain('bump_updated');
});
