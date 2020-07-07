import * as pg from 'pg';

test('connect to localhost and create an empty test database', async () => {
  const client = new pg.Client({
    host: 'localhost',
    // port?: number; // use default or set PGPORT env variable when running tests
    // user?: string; // use default or set PGUSER env variable when running tests
    // password?: string; // use default or set PGPASSWORD env variable when running tests
    database: 'postgres',
  });
  await client.connect();
});
