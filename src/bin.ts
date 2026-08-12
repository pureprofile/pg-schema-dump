#!/usr/bin/env node

import * as path from 'node:path';

import * as pg from 'pg';
import * as yargs from 'yargs';

import { PgClient } from './index';
import { loadScopeFile, mergeScope, validateScope } from './scope-file';
import { log } from './utils';

async function main() {
  const { argv } = yargs.options({
    url: { type: 'string', demandOption: true, description: 'url connection string to the pg database' },
    out: { type: 'string', description: 'path to dump the db into' },
    'scope-file': { type: 'string', description: 'path to a JSON scope manifest ({ schemas, tables, functions })' },
    'include-schema': { type: 'array', string: true, description: 'whole schema to include in the dump scope' },
    'include-table': { type: 'array', string: true, description: `'schema.table' to include in the dump scope` },
    'include-function': {
      type: 'array',
      string: true,
      description: `'schema.function' to include in the dump scope (escape hatch)`,
    },
  });

  const env = process.env.NODE_ENV || 'development';
  const { url } = argv;

  const scopeFilePath = argv['scope-file'];
  const fileScope = scopeFilePath ? loadScopeFile(scopeFilePath) : undefined;
  const flagScope = {
    includeSchemas: argv['include-schema'],
    includeTables: argv['include-table'],
    includeFunctions: argv['include-function'],
  };
  // Validated after merging so CLI flags face the same 'schema.name' rule as a
  // manifest; a bare name would otherwise activate scoping and match nothing.
  const scope = validateScope(mergeScope(fileScope, flagScope), 'scope options');

  const db = new pg.Client({ connectionString: url });
  await db.connect();
  const result = await db.query<{ dbName: string }>(`SELECT current_database() AS "dbName"`);
  const { dbName } = result.rows[0];
  await db.end();

  const out = argv.out
    ? path.resolve(process.cwd(), argv.out)
    : path.resolve(process.cwd(), 'pg-schema-dump', env, dbName);

  const client = new PgClient(url, { scope });
  await client.connect();
  await client.dumpSchema({ out });
  await client.end();
}

main().catch((error) => {
  log.error(`error dumping db: ${(error as Error).stack || error}`);
  throw error;
});
