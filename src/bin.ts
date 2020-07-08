/* eslint-disable no-process-env */

import * as path from 'path';
import * as yargs from 'yargs';
import { dumpDb } from './dump-db';
import { log } from './utils';
import * as pg from 'pg';

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

  dumpDb({
    url,
    out,
  }).catch((err) => {
    log.error(`error dumping db: ${(err as Error).stack || err}`);
  });
}

main().catch((err) => {
  log.error(err);
});
