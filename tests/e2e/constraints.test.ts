import { Client } from 'pg';
import { PgClient } from '../../src/pg-client';
import { collectConstraints } from '../../src/pg-objects/constraints';

const CONSTRAINTS_DB = 'pgsd-constraints';

const host = process.env.TEST_DB_HOST!;
const port = Number(process.env.TEST_DB_PORT);
const user = process.env.TEST_DB_USER!;
const password = process.env.TEST_DB_PASSWORD!;

let raw: Client;

beforeAll(async () => {
  const admin = new PgClient({ host, port, user, password }, { logger: null });
  await admin.ensureEmptyDb(CONSTRAINTS_DB);

  // Composite PK + a CHECK constraint on the same table.
  await admin.query(`
    CREATE TABLE membership (
      role_id integer NOT NULL,
      member_id integer NOT NULL,
      secret text,
      CONSTRAINT membership_pk PRIMARY KEY (role_id, member_id),
      CONSTRAINT membership_secret_chk CHECK (secret IS NULL OR char_length(secret) > 0)
    )
  `);

  // A multi-column UNIQUE constraint that is an FK target (not the table's PK).
  await admin.query(`
    CREATE TABLE widget (
      id serial PRIMARY KEY,
      code text NOT NULL,
      region text NOT NULL,
      CONSTRAINT widget_uk UNIQUE (code, region)
    )
  `);

  // A multi-column FK referencing widget's UNIQUE constraint.
  await admin.query(`
    CREATE TABLE widget_block (
      widget_code text NOT NULL,
      widget_region text NOT NULL,
      phone text NOT NULL,
      CONSTRAINT widget_block_fk FOREIGN KEY (widget_code, widget_region) REFERENCES widget (code, region)
    )
  `);

  await admin.end();

  raw = new Client({ host, port, user, password, database: CONSTRAINTS_DB });
  await raw.connect();
});

afterAll(async () => {
  await raw.end();

  const admin = new PgClient({ host, port, user, password }, { logger: null });
  try {
    await admin.switchDatabase('postgres');
    await admin.dropDatabase(CONSTRAINTS_DB);
  } catch {
    // ignore
  } finally {
    await admin.end();
  }
});

test('collectConstraints returns the composite primary key with both columns', async () => {
  const { constraints: rows } = await collectConstraints(raw, { skipSchemas: [] });
  const pk = rows.find((r) => r.name === 'membership_pk');
  expect(pk).toBeDefined();
  expect(pk!.type).toBe('p');
  expect(pk!.def).toBe('PRIMARY KEY (role_id, member_id)');
});

test('collectConstraints returns the multi-column unique constraint', async () => {
  const { constraints: rows } = await collectConstraints(raw, { skipSchemas: [] });
  const uk = rows.find((r) => r.name === 'widget_uk');
  expect(uk).toBeDefined();
  expect(uk!.type).toBe('u');
  expect(uk!.def).toBe('UNIQUE (code, region)');
});

test('collectConstraints returns the check constraint', async () => {
  const { constraints: rows } = await collectConstraints(raw, { skipSchemas: [] });
  const chk = rows.find((r) => r.name === 'membership_secret_chk');
  expect(chk).toBeDefined();
  expect(chk!.type).toBe('c');
  expect(chk!.def.toUpperCase()).toContain('CHECK');
});

test('collectConstraints returns the multi-column FK targeting a plain UNIQUE constraint', async () => {
  const { constraints: rows } = await collectConstraints(raw, { skipSchemas: [] });
  const fk = rows.find((r) => r.name === 'widget_block_fk');
  expect(fk).toBeDefined();
  expect(fk!.type).toBe('f');
  expect(fk!.def).toBe('FOREIGN KEY (widget_code, widget_region) REFERENCES widget(code, region)');
});
