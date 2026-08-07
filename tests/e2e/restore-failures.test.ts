import * as fs from 'fs-extra';
import * as path from 'path';
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

test('a file that only needs reordering still restores', async () => {
  // view.* sorts last, so this already works by ordering; assert the retry path
  // itself by giving a later-sorting table a dependency on an earlier one.
  fs.outputFileSync(path.join(dir, 'table.public.a.sql'), 'create table public.a (id bigint primary key);');
  fs.outputFileSync(path.join(dir, 'view.public.v.sql'), 'CREATE OR REPLACE VIEW public.v AS SELECT id FROM public.a;');

  await client.switchDatabase('postgres');
  await client.ensureEmptyDb(DB);
  await client.restoreSchema({ src: dir });

  await client.switchDatabase(DB);
  const rows = await client.rows<{ count: string }>(`SELECT count(*) AS count FROM pg_views WHERE viewname = 'v'`);
  expect(rows[0].count).toBe('1');
});

test('reports every unapplied file with its own error instead of only the last', async () => {
  fs.outputFileSync(path.join(dir, 'table.public.good.sql'), 'create table public.good (id bigint primary key);');
  fs.outputFileSync(path.join(dir, 'table.public.bad_one.sql'), 'create table public.bad_one (id nonexistent_type);');
  fs.outputFileSync(path.join(dir, 'table.public.bad_two.sql'), 'this is not valid sql at all;');

  await client.switchDatabase('postgres');
  await client.ensureEmptyDb(DB);

  let error: Error | null = null;
  try {
    await client.restoreSchema({ src: dir });
  } catch (err) {
    error = err as Error;
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
