import * as pg from 'pg';

export const TEST_DB_NAME = `db-schema-dump-test`;

export function getClient() {
  return new pg.Client({
    host: 'localhost',
    // port?: number; // use default or set PGPORT env variable when running tests
    // user?: string; // use default or set PGUSER env variable when running tests
    // password?: string; // use default or set PGPASSWORD env variable when running tests
    database: 'postgres',
  });
}
