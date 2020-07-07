import * as pg from 'pg';
import { getClient, TEST_DB_NAME } from './_pg';
import { dumpDb } from '../dump-db';
import * as path from 'path';
import * as fs from 'fs-extra';

let client: pg.Client;

afterAll(async () => {
  // close any open clients, make sure to .end() a client if a new one is being set
  await client.end();
});

test('connect to the local postgres', async () => {
  client = getClient();
  await client.connect();
});

test('check if the test database exists & drop if it does', async () => {
  const res = await client.query<{
    datname: string;
  }>(`SELECT datname FROM pg_database`);
  if (res.rows.find((r) => r.datname === TEST_DB_NAME)) {
    const drop = await client.query(`DROP DATABASE "${TEST_DB_NAME}"`);
    expect(drop.command).toBe('DROP');
  }
});

test('create an empty test database & connect to it', async () => {
  const res = await client.query(`CREATE DATABASE "${TEST_DB_NAME}"`);
  expect(res.command).toBe('CREATE');
  // close the old client and create a new one with our empty db
  await client.end();
  client = getClient(TEST_DB_NAME);
  await client.connect();
});

const dumpDirectory = path.resolve(process.cwd(), '__temp__', TEST_DB_NAME);

test('dump the empty database', async () => {
  await dumpDb({
    url: `postgres://@localhost/${TEST_DB_NAME}`,
    out: dumpDirectory,
    logger: null,
  });
});

test('empty database should produce empty dump', async () => {
  const contents = fs.readdirSync(dumpDirectory);
  expect(contents.length).toBe(0);
});

test('should create and dump a function', async () => {
  const fnName = `public.function.is_my_num_one_two_three.sql`;
  const fnBody = fs.readFileSync(path.resolve(__dirname, 'files', fnName), 'utf8');
  await client.query(fnBody);
  await dumpDb({
    url: `postgres://@localhost/${TEST_DB_NAME}`,
    out: dumpDirectory,
    logger: null,
  });

  const dirContents = fs.readdirSync(dumpDirectory);
  expect(dirContents.length).toBe(1);
  expect(dirContents[0]).toBe(fnName);

  const fileContents = fs.readFileSync(path.resolve(dumpDirectory, fnName), 'utf8');
  expect(fileContents).toBe(fnBody);
});
