import * as pg from 'pg';
import { getClient, TEST_DB_NAME } from './_pg';

let client: pg.Client;

afterAll(async () => {
  await client.end();
});

test('connect to the test database', async () => {
  client = getClient();
  await client.connect();
});

test('check if the test database exists, drop if yes', async () => {
  const res = await client.query<{
    datname: string;
  }>(`SELECT datname FROM pg_database`);
  if (res.rows.find((r) => r.datname === TEST_DB_NAME)) {
    const drop = await client.query(`DROP DATABASE "${TEST_DB_NAME}"`);
    expect(drop.command).toBe('DROP');
  }
});

test('create an empty test database', async () => {
  const res = await client.query(`CREATE DATABASE "${TEST_DB_NAME}"`);
  expect(res.command).toBe('CREATE');
});
