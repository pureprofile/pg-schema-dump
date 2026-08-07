import * as fs from 'fs-extra';
import * as path from 'path';
import { PgClient } from '../../src/pg-client';

// The tests in this file are intentionally sequential and stateful: each step
// depends on side effects of the previous one (create → dump → restore → re-dump
// → truncate). Vitest runs tests within a file in order; do not mark them concurrent.

const SRC_DB = 'pgsd-rt-src';
const DST_DB = 'pgsd-rt-dst';

const dumpDir1 = path.resolve(process.cwd(), '__temp__', SRC_DB);
const dumpDir2 = path.resolve(process.cwd(), '__temp__', DST_DB);

const client = new PgClient(
  {
    host: process.env.TEST_DB_HOST,
    port: Number(process.env.TEST_DB_PORT),
    user: process.env.TEST_DB_USER,
    password: process.env.TEST_DB_PASSWORD,
  },
  { logger: null }
);

afterAll(async () => {
  try {
    await client.switchDatabase('postgres');
    await client.dropDatabase(SRC_DB);
  } catch {
    // ignore
  }
  try {
    await client.dropDatabase(DST_DB);
  } catch {
    // ignore
  }
  await client.end();
  fs.removeSync(dumpDir1);
  fs.removeSync(dumpDir2);
});

test('create source db with rich schema', async () => {
  await client.ensureEmptyDb(SRC_DB);

  // Apply schema objects one at a time to guarantee compatibility.
  await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
  await client.query(`CREATE TYPE mood AS ENUM ('happy', 'sad')`);
  await client.query(`CREATE SEQUENCE my_seq INCREMENT 1 MINVALUE 1 MAXVALUE 1000`);
  await client.query(
    `CREATE TABLE parent (id serial primary key, created_at timestamptz default now(), name text not null)`
  );
  await client.query(
    `CREATE TABLE child (id bigserial primary key, parent_id integer references parent(id), "order" integer)`
  );
  await client.query(`CREATE INDEX idx_child_parent ON child (parent_id)`);
  await client.query(`CREATE VIEW parent_names AS SELECT id, name FROM parent`);
  await client.query(`CREATE FUNCTION bump_updated() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await client.query(`CREATE TRIGGER trg_child BEFORE UPDATE ON child FOR EACH ROW EXECUTE FUNCTION bump_updated()`);
});

test('dump source db and verify expected file prefixes present', async () => {
  await client.switchDatabase(SRC_DB);
  await client.dumpSchema({ out: dumpDir1 });

  const files = fs.readdirSync(dumpDir1);

  const expectedPrefixes = ['table.', 'fk.', 'function.', 'view.', 'sequence.', 'type.', 'schema.', 'extension.'];
  for (const prefix of expectedPrefixes) {
    expect(files.some((f) => f.startsWith(prefix))).toBe(true);
  }

  // Indexes and triggers no longer get their own files - they are merged into
  // the file for the table that owns them, which is what keeps the file count
  // manageable on a large schema.
  expect(files.some((f) => f.startsWith('index.') || f.startsWith('trigger.'))).toBe(false);
  const childTable = fs.readFileSync(path.join(dumpDir1, 'table.public.child.sql'), 'utf8');
  expect(childTable).toContain('CREATE INDEX IF NOT EXISTS idx_child_parent');
  expect(childTable).toContain('CREATE TRIGGER trg_child');
  expect(childTable).toContain('ALTER SEQUENCE public.child_id_seq OWNED BY public.child.id;');
  // the primary key is a named table constraint, not an inline column keyword
  expect(childTable).toContain('constraint child_pkey PRIMARY KEY (id)');

  // one foreign key file per table, not per column
  expect(files.filter((f) => f.startsWith('fk.'))).toEqual(['fk.public.child.sql']);
});

test('restore source dump into destination db', async () => {
  await client.switchDatabase('postgres');
  await client.ensureEmptyDb(DST_DB);
  await client.restoreSchema({ src: dumpDir1 });
});

test('re-dump destination and verify key objects are present', async () => {
  await client.switchDatabase(DST_DB);
  await client.dumpSchema({ out: dumpDir2 });

  const files1 = fs.readdirSync(dumpDir1).sort();
  const files2 = fs.readdirSync(dumpDir2).sort();

  // The round trip is exact in both directions. It previously was not: serial
  // shorthand made Postgres auto-create a sequence that collided with the one
  // the dump emitted separately, so the restored database ended up with extra
  // sequences under auto-suffixed names (child_id_seq1). Emitting the raw
  // nextval() default instead removed that whole failure mode.
  expect(files2).toEqual(files1);

  for (const f of files1) {
    const content1 = fs.readFileSync(path.join(dumpDir1, f), 'utf8');
    const content2 = fs.readFileSync(path.join(dumpDir2, f), 'utf8');
    expect(content2).toBe(content1);
  }
});

test('truncateTables on destination db completes without error', async () => {
  await client.switchDatabase('postgres');
  await client.truncateTables(DST_DB);
});

// Two shapes that legacy schemas hit in practice, and that this tool used to either
// silently drop or fail the restore on.
test('restores a foreign key cycle and a multi-column key referencing a UNIQUE constraint', async () => {
  const cycleSrc = 'pgsd-rt-hard-src';
  const cycleDst = 'pgsd-rt-hard-dst';
  const dir = path.resolve(process.cwd(), '__temp__', cycleSrc);

  try {
    await client.switchDatabase('postgres');
    await client.ensureEmptyDb(cycleSrc);

    // mutually referencing tables: neither can be created with its foreign key
    // already in place, so all tables must exist before any key is added
    await client.query(`CREATE TABLE node (id bigserial primary key, label_id bigint)`);
    await client.query(`CREATE TABLE label (id bigserial primary key, node_id bigint)`);
    await client.query(`ALTER TABLE node ADD CONSTRAINT node_label_fk FOREIGN KEY (label_id) REFERENCES label(id)`);
    await client.query(`ALTER TABLE label ADD CONSTRAINT label_node_fk FOREIGN KEY (node_id) REFERENCES node(id)`);

    // a composite primary key
    await client.query(`CREATE TABLE membership (role_id bigint, member_id bigint,
      PRIMARY KEY (role_id, member_id))`);

    // a two-column foreign key whose target is a plain UNIQUE constraint rather
    // than the primary key. Postgres rejects the key unless that exact UNIQUE
    // constraint exists, so dropping it makes the restore fail, not just drift.
    await client.query(`CREATE TABLE widget (id bigint primary key, tenant_id bigint,
      CONSTRAINT widget_uk UNIQUE (tenant_id, id))`);
    await client.query(`CREATE TABLE child_ref (id bigserial primary key, tenant_id bigint, widget_id bigint,
      CONSTRAINT child_widget_fk FOREIGN KEY (tenant_id, widget_id) REFERENCES widget(tenant_id, id))`);
    await client.query(`CREATE TABLE bounded (id bigserial primary key, amount numeric,
      CONSTRAINT bounded_amount_chk CHECK (amount > (0)::numeric))`);

    await client.switchDatabase(cycleSrc);
    await client.dumpSchema({ out: dir });

    await client.switchDatabase('postgres');
    await client.ensureEmptyDb(cycleDst);
    await client.restoreSchema({ src: dir });

    await client.switchDatabase(cycleDst);
    const constraints = await client.rows<{ name: string; def: string }>(`
      SELECT conname AS "name", pg_get_constraintdef(oid) AS "def" FROM pg_constraint
      WHERE conname IN ('node_label_fk','label_node_fk','membership_pkey','widget_uk','child_widget_fk','bounded_amount_chk')
      ORDER BY 1
    `);
    const byName: { [name: string]: string } = {};
    for (const row of constraints) {
      byName[row.name] = row.def;
    }
    expect(byName.membership_pkey).toBe('PRIMARY KEY (role_id, member_id)');
    expect(byName.widget_uk).toBe('UNIQUE (tenant_id, id)');
    expect(byName.child_widget_fk).toBe('FOREIGN KEY (tenant_id, widget_id) REFERENCES widget(tenant_id, id)');
    expect(byName.bounded_amount_chk).toBe('CHECK ((amount > (0)::numeric))');
    expect(byName.node_label_fk).toBeDefined();
    expect(byName.label_node_fk).toBeDefined();

    // the CHECK constraint is enforced, not merely present
    await expect(client.query(`INSERT INTO bounded (amount) VALUES (-1)`)).rejects.toThrow(/bounded_amount_chk/);
  } finally {
    try {
      await client.switchDatabase('postgres');
      await client.dropDatabase(cycleSrc);
    } catch {
      // ignore
    }
    try {
      await client.dropDatabase(cycleDst);
    } catch {
      // ignore
    }
    fs.removeSync(dir);
  }
});
