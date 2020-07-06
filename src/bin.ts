/* eslint-disable no-process-env */

import * as path from 'path';
import * as yargs from 'yargs';
import { dumpDb } from './dump-db';
import { logError } from './utils';
import { Sequelize } from 'sequelize';

const argv = yargs.options({
  url: { type: 'string', demandOption: true, description: 'url connection string to the pg database' },
  out: { type: 'string', description: 'path to dump the db into' },
}).argv;

const env = process.env.NODE_ENV || 'development';
const url = argv.url;
const db = new Sequelize(url, { logging: false });
const out = argv.out
  ? path.resolve(process.cwd(), argv.out)
  : path.resolve(process.cwd(), 'db-schema-dump', env, db.getDatabaseName());

dumpDb({
  url,
  out,
}).catch((err) => {
  logError(`error dumping db: ${(err as Error).stack || err}`);
});
