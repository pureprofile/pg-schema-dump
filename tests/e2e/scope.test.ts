import * as fs from 'fs-extra';
import * as path from 'path';
import { PgClient } from '../../src/pg-client';

// The scope closure is the newest and most intricate SQL in the tool, and every
// path through it fails the same silent way: the object is simply absent from the
// dump. A restore then breaks much later, or - worse, for a sequence a trigger
// reaches - not until the first insert.
//
// So this exercises a scope end to end against a real database rather than
// asserting on predicate strings: dump a schema whose dependencies all leave the
// requested scope by a *different* route, restore it into an empty database, and
// use it.

const SRC_DB = 'pgsd-scope-src';
const DST_DB = 'pgsd-scope-dst';
const dir = path.resolve(process.cwd(), '__temp__', SRC_DB);

const host = process.env.TEST_DB_HOST!;
const port = Number(process.env.TEST_DB_PORT);
const user = process.env.TEST_DB_USER!;
const password = process.env.TEST_DB_PASSWORD!;

const connection = { host, port, user, password };

let omissions: Awaited<ReturnType<PgClient['dumpSchema']>>;
let files: string[];

beforeAll(async () => {
  const admin = new PgClient(connection, { logger: null });
  await admin.ensureEmptyDb(SRC_DB);

  await admin.query(`CREATE SCHEMA keep`);
  await admin.query(`CREATE SCHEMA outside`);
  // The enum lives in a schema the scope never names, reachable only by column use.
  await admin.query(`CREATE SCHEMA enums`);
  await admin.query(`CREATE TYPE enums.item_state AS ENUM ('new', 'done')`);
  // Nothing in `helpers` is in scope by schema. Everything kept from here has to be
  // kept by a dependency path, which is the whole point of the fixture: `keep` alone
  // would be satisfied by the plain "this schema was opted in" branch and would
  // prove nothing about the closure.
  await admin.query(`CREATE SCHEMA helpers`);

  // Out of scope, and the target of an in-scope foreign key.
  await admin.query(`CREATE TABLE outside.region (id integer PRIMARY KEY)`);

  // Owned by nothing, in no in-scope schema, named by no column default - the only
  // thing that mentions it is the trigger function's body.
  await admin.query(`CREATE SEQUENCE helpers.hidden_seq`);
  // Named by an in-scope table's CHECK constraint and nothing else. Postgres does allow
  // a volatile function there (unlike an expression index, which requires IMMUTABLE), so
  // this is a legal way for a relation to depend on a sequence without a column default.
  await admin.query(`CREATE SEQUENCE helpers.check_seq`);

  // inner_fn is reached only through outer_fn's body. Postgres records no dependency
  // between two plpgsql functions, so only the recursive text pass finds it.
  await admin.query(
    `CREATE FUNCTION helpers.inner_fn(n integer) RETURNS integer AS $$ BEGIN RETURN n * 2; END; $$ LANGUAGE plpgsql`
  );
  await admin.query(
    `CREATE FUNCTION helpers.outer_fn(n integer) RETURNS integer AS $$ BEGIN RETURN helpers.inner_fn(n) + 1; END; $$ LANGUAGE plpgsql`
  );
  await admin.query(`
    CREATE FUNCTION helpers.stamp() RETURNS trigger AS $$
    BEGIN
      NEW.ticket := nextval('helpers.hidden_seq');
      RETURN NEW;
    END; $$ LANGUAGE plpgsql
  `);

  await admin.query(`
    CREATE TABLE keep.item (
      id serial PRIMARY KEY,
      state enums.item_state NOT NULL DEFAULT 'new',
      ticket bigint,
      doubled integer DEFAULT helpers.outer_fn(2),
      region_id integer REFERENCES outside.region (id),
      guard bigint,
      -- Left as NULL by every insert below, so the short-circuit keeps nextval out of the
      -- way of the ticket assertions while the dependency still exists in the catalog.
      CONSTRAINT item_guard_chk CHECK (guard IS NULL OR guard < nextval('helpers.check_seq'))
    )
  `);
  await admin.query(
    `CREATE TRIGGER item_stamp BEFORE INSERT ON keep.item FOR EACH ROW EXECUTE FUNCTION helpers.stamp()`
  );

  // Reads an out-of-scope table, so it cannot be restored and must be dropped.
  await admin.query(`
    CREATE VIEW keep.item_regions AS
      SELECT i.id, r.id AS region FROM keep.item i JOIN outside.region r ON r.id = i.region_id
  `);
  // Reads only in-scope things, so it stays.
  await admin.query(`CREATE VIEW keep.item_ids AS SELECT id FROM keep.item`);
  // Reads another *view*. A view is never named by a table scope, so judging this
  // dependency with the table predicate would drop the whole chain.
  await admin.query(`CREATE VIEW keep.item_ids_chained AS SELECT id FROM keep.item_ids`);
  // ...and a chain built on a view that does not survive has to fall with it.
  await admin.query(`CREATE VIEW keep.regions_chained AS SELECT id FROM keep.item_regions`);
  await admin.end();

  // A table list, not a schema list, on purpose. `includeSchemas: ['keep']` would
  // make every object in `keep` satisfy the scope predicate directly, so the views
  // and functions there would be kept by the plain "named schema" branch and none of
  // the dependency-following below would be under test.
  const client = new PgClient(
    { ...connection, database: SRC_DB },
    { logger: null, scope: { includeTables: ['keep.item'] } }
  );
  omissions = await client.dumpSchema({ out: dir });
  await client.end();
  files = await fs.readdir(dir);
});

afterAll(async () => {
  const admin = new PgClient(connection, { logger: null });
  for (const db of [SRC_DB, DST_DB]) {
    try {
      await admin.switchDatabase('postgres');
      await admin.dropDatabase(db);
    } catch {
      // ignore
    }
  }
  await admin.end();
  fs.removeSync(dir);
});

test('keeps a function reached only from another in-scope function body', () => {
  // outer_fn arrives via the in-scope column default; inner_fn only via outer_fn's
  // body, which is the edge pg_depend cannot see.
  expect(files).toContain('function.helpers.outer_fn.sql');
  expect(files).toContain('function.helpers.inner_fn.sql');
  // ...and the trigger's function, or the CREATE TRIGGER in the table file fails.
  expect(files).toContain('function.helpers.stamp.sql');
});

test('keeps a sequence named only inside an in-scope function body', () => {
  expect(files).toContain('sequence.helpers.hidden_seq.sql');
});

test('keeps a sequence named only by an in-scope table constraint', () => {
  // Not a column default, which is the one dependency path the sequence collector used
  // to check. Without it the CHECK cannot be created and the table's own file fails.
  expect(files).toContain('sequence.helpers.check_seq.sql');
});

test('keeps an enum used by an in-scope column but declared in an unnamed schema', () => {
  expect(files).toContain('type.enums.item_state.sql');
  // ...and the schema to put it in, or the restore has nowhere to create it.
  expect(files).toContain('schema.enums.sql');
});

test('leaves out-of-scope tables out', () => {
  expect(files).not.toContain('table.outside.region.sql');
});

test('drops a foreign key whose target is out of scope, and reports it', () => {
  const fkFile = files.find((f) => f.startsWith('fk.keep.item'));
  expect(fkFile).toBeUndefined();
  expect(omissions.droppedForeignKeys).toHaveLength(1);
  expect(omissions.droppedForeignKeys[0]).toMatchObject({
    schema: 'keep',
    table: 'item',
    target: 'outside.region',
  });
});

test('excludes a view reading an out-of-scope table, and reports it', () => {
  expect(files).not.toContain('view.keep.item_regions.sql');
  expect(omissions.excludedViews).toEqual(
    expect.arrayContaining([{ view: 'keep.item_regions', cause: 'outside.region' }])
  );
});

test('keeps a view whose dependencies are all in scope', () => {
  expect(files).toContain('view.keep.item_ids.sql');
});

test('keeps a view built on another kept view', () => {
  // A view is never named by a table scope, so testing this dependency against the
  // table predicate would drop every chain of views.
  expect(files).toContain('view.keep.item_ids_chained.sql');
});

test('drops a view built on an excluded view, naming the view that took it down', () => {
  expect(files).not.toContain('view.keep.regions_chained.sql');
  expect(omissions.excludedViews).toEqual(
    expect.arrayContaining([{ view: 'keep.regions_chained', cause: 'keep.item_regions' }])
  );
});

test('the scoped dump restores into an empty database and the trigger sequence works', async () => {
  const admin = new PgClient(connection, { logger: null });
  await admin.ensureEmptyDb(DST_DB);
  await admin.end();

  const restored = new PgClient({ ...connection, database: DST_DB }, { logger: null });
  // Throws and names the offending files if the closure missed anything.
  await restored.restoreSchema({ src: dir });

  // The insert is the assertion that matters for hidden_seq: a dump that omitted it
  // restores perfectly happily and only fails here.
  await restored.query(`INSERT INTO keep.item (state) VALUES ('done')`);
  const rows = await restored.rows<{ ticket: string; doubled: number }>(`SELECT ticket, doubled FROM keep.item`);
  expect(rows).toHaveLength(1);
  expect(rows[0].ticket).toBe('1');
  // proves outer_fn -> inner_fn survived, since the default calls through both
  expect(rows[0].doubled).toBe(5);
  await restored.end();
});
