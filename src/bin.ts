#!/usr/bin/env node

import * as path from 'path';
import * as yargs from 'yargs';
import * as pg from 'pg';
import { log } from './utils';
import { PgClient } from './index';
import { loadScopeFile, mergeScope, validateScope } from './scope-file';

async function main() {
  const argv = yargs.options({
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
  }).argv;

  // eslint-disable-next-line no-process-env
  const env = process.env.NODE_ENV || 'development';
  const url = argv.url;

  const scopeFilePath = argv['scope-file'] as string | undefined;
  const fileScope = scopeFilePath ? loadScopeFile(scopeFilePath) : undefined;
  const flagScope = {
    includeSchemas: argv['include-schema'] as string[] | undefined,
    includeTables: argv['include-table'] as string[] | undefined,
    includeFunctions: argv['include-function'] as string[] | undefined,
  };
  // Validated after merging so CLI flags face the same 'schema.name' rule as a
  // manifest; a bare name would otherwise activate scoping and match nothing.
  const scope = validateScope(mergeScope(fileScope, flagScope), 'scope options');

  const db = new pg.Client({ connectionString: url });
  await db.connect();
  const result = await db.query<{ dbName: string }>(`SELECT current_database() AS "dbName"`);
  const dbName = result.rows[0].dbName;
  await db.end();

  const out = argv.out
    ? path.resolve(process.cwd(), argv.out)
    : path.resolve(process.cwd(), 'pg-schema-dump', env, dbName);

  const client = new PgClient(url, { scope });
  await client.connect();
  await client.dumpSchema({ out });
  await client.end();
}

main().catch((err) => {
  log.error(`error dumping db: ${(err as Error).stack || err}`);
  throw err;
});
