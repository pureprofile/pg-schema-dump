import * as path from 'node:path';

import * as fs from 'fs-extra';

import { PgClient } from '../../src/pg-client';

// A restore that cannot complete has to say which files were left unapplied and
// why. The previous implementation tracked failures in a single array that any
// unrelated success emptied, so a permanently broken file was requeued over and
// over and the eventual error named only whichever file happened to fail last.

const DB = 'pgsd-restore-fail';
const dir = path.resolve(process.cwd(), '__temp__', DB);

const client = new PgClient(
  {
    host: process.env.TEST_DB_HOST,
    port: Number(process.env.TEST_DB_PORT),
    user: process.env.TEST_DB_USER,
    password: process.env.TEST_DB_PASSWORD,
  },
  { logger: null }
);

beforeEach(() => {
  fs.emptyDirSync(dir);
});

afterAll(async () => {
  try {
    await client.switchDatabase('postgres');
    await client.dropDatabase(DB);
  } catch {
    // ignore
  }
  await client.end();
  fs.removeSync(dir);
});

test('a file whose dependency sorts after it is requeued and then succeeds', async () => {
  // The bucket order has to actually be violated for the retry path to run, so the
  // dependency lives under an unknown prefix, which sorts last. table.* is attempted
  // first, fails, goes to the back of the queue, and succeeds on the second pass.
  fs.outputFileSync(
    path.join(dir, 'table.public.needs_later.sql'),
    'create table public.needs_later (id bigint primary key references public.arrives_later(id));'
  );
  fs.outputFileSync(
    path.join(dir, 'zzz.public.arrives_later.sql'),
    'create table public.arrives_later (id bigint primary key);'
  );

  await client.switchDatabase('postgres');
  await client.ensureEmptyDb(DB);
  await client.restoreSchema({ src: dir });

  await client.switchDatabase(DB);
  const rows = await client.rows<{ count: string }>(
    `SELECT count(*) AS count FROM pg_tables WHERE tablename IN ('needs_later', 'arrives_later')`
  );
  expect(rows[0].count).toBe('2');
});

test('reports every unapplied file with its own error instead of only the last', async () => {
  fs.outputFileSync(path.join(dir, 'table.public.good.sql'), 'create table public.good (id bigint primary key);');
  fs.outputFileSync(path.join(dir, 'table.public.bad_one.sql'), 'create table public.bad_one (id nonexistent_type);');
  fs.outputFileSync(path.join(dir, 'table.public.bad_two.sql'), 'this is not valid sql at all;');

  await client.switchDatabase('postgres');
  await client.ensureEmptyDb(DB);

  const error: Error | null = null;
  try {
    await client.restoreSchema({ src: dir });
  } catch (error) {
    error = error as Error;
  }

  expect(error).not.toBeNull();
  expect(error!.message).toContain('2 file(s) could not be applied');
  // both failures are named, each with its own cause
  expect(error!.message).toContain('table.public.bad_one.sql');
  expect(error!.message).toContain('table.public.bad_two.sql');
  expect(error!.message).toMatch(/nonexistent_type/);
  // the healthy file was still applied
  await client.switchDatabase(DB);
  const rows = await client.rows<{ count: string }>(`SELECT count(*) AS count FROM pg_tables WHERE tablename = 'good'`);
  expect(rows[0].count).toBe('1');
});

test('keeps a unique index that only a foreign key on another table depends on', async () => {
  // pg_constraint.conindid is set on FOREIGN KEY constraints too, pointing at the
  // index on the *referenced* table. Excluding every index named by some
  // constraint's conindid therefore dropped plain unique indexes that foreign
  // keys rely on, and the restore failed with "there is no unique constraint
  // matching given keys for referenced table".
  const src = 'pgsd-uqidx-src';
  const dst = 'pgsd-uqidx-dst';
  const dir = path.resolve(process.cwd(), '__temp__', src);

  try {
    await client.switchDatabase('postgres');
    await client.ensureEmptyDb(src);
    await client.query(`CREATE TABLE country (id bigserial primary key, code varchar(10) not null)`);
    // uniqueness via a bare index, not a UNIQUE constraint
    await client.query(`CREATE UNIQUE INDEX country_code_idx ON country (code)`);
    await client.query(`CREATE TABLE token (id bigserial primary key, country_code varchar(10),
      CONSTRAINT tok_coun_fk FOREIGN KEY (country_code) REFERENCES country(code))`);

    await client.switchDatabase(src);
    await client.dumpSchema({ out: dir });

    const countryFile = fs.readFileSync(path.join(dir, 'table.public.country.sql'), 'utf-8');
    expect(countryFile).toContain('country_code_idx');
    // the primary key's own index is still excluded, since the constraint recreates it
    expect(countryFile).not.toContain('CREATE UNIQUE INDEX IF NOT EXISTS country_pkey');

    await client.switchDatabase('postgres');
    await client.ensureEmptyDb(dst);
    await client.restoreSchema({ src: dir });
  } finally {
    try {
      await client.switchDatabase('postgres');
      await client.dropDatabase(src);
    } catch {
      // ignore
    }
    try {
      await client.dropDatabase(dst);
    } catch {
      // ignore
    }
    fs.removeSync(dir);
  }
});

test('function bodies may reference tables that do not exist yet', async () => {
  // Functions restore before tables, so check_function_bodies must be off.
  fs.outputFileSync(
    path.join(dir, 'function.public.reads_later_table.sql'),
    `CREATE OR REPLACE FUNCTION public.reads_later_table() RETURNS bigint AS $$
       SELECT count(*) FROM public.created_after_me;
     $$ LANGUAGE sql`
  );
  fs.outputFileSync(
    path.join(dir, 'table.public.created_after_me.sql'),
    'create table public.created_after_me (id bigint primary key);'
  );

  await client.switchDatabase('postgres');
  await client.ensureEmptyDb(DB);
  await client.restoreSchema({ src: dir });

  await client.switchDatabase(DB);
  const rows = await client.rows<{ result: string }>(`SELECT public.reads_later_table() AS result`);
  expect(rows[0].result).toBe('0');
});
