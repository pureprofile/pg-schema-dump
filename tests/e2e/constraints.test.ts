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
    CREATE TABLE auth_data (
      auth_method_id integer NOT NULL,
      account_holder_id integer NOT NULL,
      secret text,
      CONSTRAINT auth_data_pk PRIMARY KEY (auth_method_id, account_holder_id),
      CONSTRAINT auth_data_secret_chk CHECK (secret IS NULL OR char_length(secret) > 0)
    )
  `);

  // A multi-column UNIQUE constraint that is an FK target (not the table's PK).
  await admin.query(`
    CREATE TABLE platform (
      id serial PRIMARY KEY,
      code text NOT NULL,
      region text NOT NULL,
      CONSTRAINT plat_uk UNIQUE (code, region)
    )
  `);

  // A multi-column FK referencing platform's UNIQUE constraint.
  await admin.query(`
    CREATE TABLE mobile_number_barred (
      platform_code text NOT NULL,
      platform_region text NOT NULL,
      phone text NOT NULL,
      CONSTRAINT mnb_platform_fk FOREIGN KEY (platform_code, platform_region) REFERENCES platform (code, region)
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
  const pk = rows.find((r) => r.name === 'auth_data_pk');
  expect(pk).toBeDefined();
  expect(pk!.type).toBe('p');
  expect(pk!.def).toBe('PRIMARY KEY (auth_method_id, account_holder_id)');
});

test('collectConstraints returns the multi-column unique constraint', async () => {
  const { constraints: rows } = await collectConstraints(raw, { skipSchemas: [] });
  const uk = rows.find((r) => r.name === 'plat_uk');
  expect(uk).toBeDefined();
  expect(uk!.type).toBe('u');
  expect(uk!.def).toBe('UNIQUE (code, region)');
});

test('collectConstraints returns the check constraint', async () => {
  const { constraints: rows } = await collectConstraints(raw, { skipSchemas: [] });
  const chk = rows.find((r) => r.name === 'auth_data_secret_chk');
  expect(chk).toBeDefined();
  expect(chk!.type).toBe('c');
  expect(chk!.def.toUpperCase()).toContain('CHECK');
});

test('collectConstraints returns the multi-column FK targeting a plain UNIQUE constraint', async () => {
  const { constraints: rows } = await collectConstraints(raw, { skipSchemas: [] });
  const fk = rows.find((r) => r.name === 'mnb_platform_fk');
  expect(fk).toBeDefined();
  expect(fk!.type).toBe('f');
  expect(fk!.def).toBe('FOREIGN KEY (platform_code, platform_region) REFERENCES platform(code, region)');
});
