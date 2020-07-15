import * as fs from 'fs-extra';
import * as path from 'path';
import { PgClient } from '../pg-client';

const TEST_DB_NAME = `pg-schema-dump-test`;
const client = new PgClient({ host: 'localhost' }, { logger: null });

afterAll(async () => {
  await client.end();
});

test('connect to the local postgres', async () => {
  await client.connect();
});

test('check if the test database exists & drop if it does', async () => {
  if (await client.databaseExists(TEST_DB_NAME)) {
    const drop = await client.dropDatabase(TEST_DB_NAME);
    expect(drop.command).toBe('DROP');
  }
  expect(await client.databaseExists(TEST_DB_NAME)).toBe(false);
});

test('create an empty test database & switch to it', async () => {
  const res = await client.createDatabase(TEST_DB_NAME);
  expect(res.command).toBe('CREATE');
  await client.switchDatabase(TEST_DB_NAME);
});

const dumpDirectory = path.resolve(process.cwd(), '__temp__', TEST_DB_NAME);

test('dump the empty database', async () => {
  await client.dumpSchema({
    out: dumpDirectory,
  });
});

test('empty database should produce empty dump', async () => {
  const contents = fs.readdirSync(dumpDirectory);
  expect(contents.length).toBe(0);
});

test('should create and dump a function', async () => {
  const fnName = `function.public.is_my_num_one_two_three.sql`;
  const fnBody = fs.readFileSync(path.resolve(__dirname, 'files', fnName), 'utf8');
  await client.query(fnBody);
  await client.dumpSchema({
    out: dumpDirectory,
  });

  const dirContents = fs.readdirSync(dumpDirectory);
  expect(dirContents.length).toBe(2);
  expect(dirContents.includes('schema.public.sql')).toBe(true);
  expect(dirContents.includes(fnName)).toBe(true);

  const fileContents = fs.readFileSync(path.resolve(dumpDirectory, fnName), 'utf8');
  expect(fileContents).toBe(fnBody);
});
