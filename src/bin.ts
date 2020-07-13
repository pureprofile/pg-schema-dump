/* eslint-disable no-process-env */

import * as path from 'path';
import * as yargs from 'yargs';
import * as pg from 'pg';
import { log } from './utils';
import { PgClient } from './index';

async function main() {
  const argv = yargs.options({
    url: { type: 'string', demandOption: true, description: 'url connection string to the pg database' },
    out: { type: 'string', description: 'path to dump the db into' },
  }).argv;

  const env = process.env.NODE_ENV || 'development';
  const url = argv.url;

  const db = new pg.Client({ connectionString: url });
  await db.connect();
  const result = await db.query<{ dbName: string }>(`SELECT current_database() AS "dbName"`);
  const dbName = result.rows[0].dbName;
  await db.end();

  const out = argv.out
    ? path.resolve(process.cwd(), argv.out)
    : path.resolve(process.cwd(), 'pg-schema-dump', env, dbName);

  const client = new PgClient(url);
  await client.connect();
  await client.dumpSchema({ out });
  await client.end();
}

main().catch((err) => {
  log.error(`error dumping db: ${(err as Error).stack || err}`);
  throw err;
});
