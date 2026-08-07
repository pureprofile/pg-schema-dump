import * as pg from 'pg';
import { all, findAndShiftFunctionReferences, pgQuoteStrings } from './pg-helpers';
import { log } from './utils';
import { parse as parsePgConnectionString } from 'pg-connection-string';
import { FsSchema } from './fs-schema';
import { uniq } from 'lodash';
import { collectIndexes } from './pg-objects/indexes';
import { collectExtensions } from './pg-objects/extensions';
import { collectTypes } from './pg-objects/types';
import { collectTables } from './pg-objects/tables';
import { collectViews } from './pg-objects/views';
import { collectFunctions } from './pg-objects/functions';
import { collectTriggers } from './pg-objects/triggers';
import { collectSequences } from './pg-objects/sequences';
import { resolveScope, ResolvedScope, ScopeOptions } from './scope';

const DEFAULT_SCHEMAS_TO_SKIP: string[] = ['pg_catalog', 'information_schema'];
const DEFAULT_FUNCTIONS_TO_SKIP: string[] = [];

export class PgClient {
  private _clientConfig: pg.ClientConfig;
  private _client: pg.Client | null = null;
  private _logger: typeof log | null;
  private _skipSchemas: string[];
  private _skipFunctions: string[];
  private _skipExtensions: string[];
  private _scope: ResolvedScope;
  private _scopeSchemasCount: number;
  private _scopeTablesCount: number;

  constructor(
    config: string | pg.ClientConfig,
    options: {
      logger?: typeof log | null;
      skipSchemas?: string[];
      skipFunctions?: string[];
      skipExtensions?: string[];
      scope?: ScopeOptions;
    } = {}
  ) {
    if (typeof config === 'string') {
      this._clientConfig = parsePgConnectionString(config) as pg.ClientConfig;
    } else {
      this._clientConfig = {
        database: 'postgres', // default db, otherwise it would not connect
        ...config,
      };
    }
    this._logger = options.logger !== undefined ? options.logger : log;
    this._skipSchemas = DEFAULT_SCHEMAS_TO_SKIP.concat(options.skipSchemas || []);
    this._skipFunctions = DEFAULT_FUNCTIONS_TO_SKIP.concat(options.skipFunctions || []);
    this._skipExtensions = options.skipExtensions || [];
    this._scope = resolveScope(options.scope);
    this._scopeSchemasCount = (options.scope?.includeSchemas || []).length;
    this._scopeTablesCount = (options.scope?.includeTables || []).length;
  }

  async connect() {
    if (!this._client) {
      this._client = new pg.Client(this._clientConfig);
      await this._client.connect();
    }
  }

  async end() {
    if (this._client) {
      await this._client.end();
      this._client = null;
    }
  }

  async testConnection() {
    await this.connect();
    await this.end();
  }

  // wrapper around client.query that does not keep the connection open
  async query<T>(query: string) {
    await this.connect();
    const result = await this._client!.query<T>(query);
    await this.end();
    return result;
  }

  async rows<T>(query: string) {
    const result = await this.query<T>(query);
    return result.rows;
  }

  async getDatabases(): Promise<string[]> {
    const rows = await this.rows<{ datname: string }>(`SELECT datname FROM pg_database`);
    return rows.map((row) => row.datname);
  }

  async getCurrentDatabase(): Promise<string> {
    const rows = await this.rows<{ dbName: string }>(`SELECT current_database() AS "dbName"`);
    return rows[0].dbName;
  }

  async databaseExists(db: string) {
    const databases = await this.getDatabases();
    return databases.some((x) => x === db);
  }

  createDatabase(db: string) {
    return this.query(`CREATE DATABASE "${db}"`);
  }

  async getConnections(db: string) {
    return this.rows<{ pid: number }>(
      `SELECT pid FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND pg_stat_activity.datname = '${db}'`
    );
  }

  async dropConnections(db: string) {
    const connections = await this.getConnections(db);
    for (const c of connections) {
      await this.query(`SELECT pg_terminate_backend(${c.pid})`);
    }
  }

  async dropDatabase(db: string) {
    await this.dropConnections(db);
    return this.query(`DROP DATABASE "${db}"`);
  }

  async switchDatabase(db: string) {
    // we need to end the old connection to the db before switch
    await this.end();
    this._clientConfig.database = db;
    // we test the connection to the new db immediatelly
    await this.testConnection();
  }

  async ensureEmptyDb(db: string) {
    if (await this.databaseExists(db)) {
      await this.dropDatabase(db);
    }
    await this.createDatabase(db);
    await this.switchDatabase(db);
  }

  async dumpSchema({ out }: { out: string }) {
    const fsSchema = new FsSchema(out, this._logger);
    this._logger?.info(`dumping contents into: ${out}`);
    fsSchema.clean();

    const skipSchemas = this._skipSchemas;
    const skipFunctions = this._skipFunctions;
    const skipExtensions = this._skipExtensions;
    const scope = this._scope;

    if (scope.active) {
      this._logger?.info(`scope active: ${this._scopeSchemasCount} schemas, ${this._scopeTablesCount} tables`);
    }

    await this.connect();
    if (!this._client) {
      throw new Error(`this.connect() should ensure client exists`);
    }
    const [, , functions, indexes, sequences, tables, triggers, views] = await Promise.all([
      collectExtensions(this._client, { skipExtensions }).then(all(fsSchema.writeExtension)),
      collectTypes(this._client, { scope }).then(all(fsSchema.writeType)),
      collectFunctions(this._client, { skipSchemas, skipFunctions, scope }).then(all(fsSchema.writeFunction)),
      collectIndexes(this._client, { skipSchemas, scope }).then(all(fsSchema.writeIndex)),
      collectSequences(this._client, { skipSchemas, scope }).then(all(fsSchema.writeSequence)),
      collectTables(this._client, { skipSchemas, scope }).then(all(fsSchema.writeTable)),
      collectTriggers(this._client, { skipSchemas, scope }).then(all(fsSchema.writeTrigger)),
      collectViews(this._client, { skipSchemas, scope }).then(all(fsSchema.writeView)),
    ] as const);

    if (scope.active) {
      await this._logScopeIntegrityReport(scope);
    }

    await this.end();

    const getSchema = <T extends { schema: string }>(arg: T) => arg.schema;
    uniq([
      ...functions.map(getSchema),
      ...indexes.map(getSchema),
      ...sequences.map(getSchema),
      ...tables.map(getSchema),
      ...triggers.map(getSchema),
      ...views.map(getSchema),
    ]).map((schema) => fsSchema.writeSchema({ schema }));

    this._logger?.info(`finished dump of: ${await this.getCurrentDatabase()}`);
  }

  private async _logScopeIntegrityReport(scope: ResolvedScope) {
    if (!this._client) {
      return;
    }

    const droppedFks = await this._client.query<{ column: string; target: string }>(`
      SELECT
        (sn.nspname || '.' || sc.relname || '.' || sa.attname) AS "column",
        (tn.nspname || '.' || tc.relname) AS "target"
      FROM pg_constraint r
      JOIN pg_class sc ON sc.oid = r.conrelid
      JOIN pg_namespace sn ON sn.oid = sc.relnamespace
      JOIN pg_attribute sa ON sa.attrelid = r.conrelid AND sa.attnum = r.conkey[1]
      JOIN pg_class tc ON tc.oid = r.confrelid
      JOIN pg_namespace tn ON tn.oid = tc.relnamespace
      WHERE r.contype = 'f'
        AND array_length(r.confkey, 1) = 1
        AND ${scope.tablePredicate('sn.nspname', 'sc.relname')}
        AND NOT (${scope.tablePredicate('tn.nspname', 'tc.relname')})
    `);
    for (const row of droppedFks.rows) {
      this._logger?.warn(`scope: dropped FK ${row.column} -> ${row.target} (target out of scope)`);
    }

    const excludedViews = await this._client.query<{ view: string; cause: string }>(`
      SELECT DISTINCT
        (n.nspname || '.' || c.relname) AS "view",
        (dn.nspname || '.' || dc.relname) AS "cause"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_rewrite rw ON rw.ev_class = c.oid
      JOIN pg_depend dep ON dep.objid = rw.oid AND dep.classid = 'pg_rewrite'::regclass
      JOIN pg_class dc ON dc.oid = dep.refobjid
      JOIN pg_namespace dn ON dn.oid = dc.relnamespace
      WHERE c.relkind = 'v'
        AND dep.refclassid = 'pg_class'::regclass
        AND dep.refobjid <> c.oid
        AND dc.relkind IN ('r','v','m','p')
        AND NOT (${scope.tablePredicate('dn.nspname', 'dc.relname')})
    `);
    for (const row of excludedViews.rows) {
      this._logger?.warn(`scope: excluded view ${row.view} (depends on out-of-scope relation ${row.cause})`);
    }
  }

  async restoreSchema({ src }: { src: string }) {
    await this.connect();
    const fsSchema = new FsSchema(src, this._logger);
    this._logger?.info(`reading contents from: ${src}`);
    const fNames = await fsSchema.readDir();
    const fHasErrored: string[] = [];
    while (fNames.length > 0) {
      const fName = fNames[0];
      const fContents = await fsSchema.read(fName);

      // handle references
      if (findAndShiftFunctionReferences(fName, fContents, fNames)) {
        continue;
      }

      try {
        await this._client!.query(fContents);
        // remove the file if it was processed without error
        fNames.shift();
        // empty the fHasErrored array
        fHasErrored.splice(0, fHasErrored.length);
      } catch (err) {
        // if the file has not errored yet, move it to the end of the file stack
        if (!fHasErrored.includes(fName)) {
          fHasErrored.push(fName);
          fNames.shift();
          fNames.push(fName);
          continue;
        }
        this._logger?.error(`error processing file ${fName}: ${(err as Error).stack || err}`);
        throw err;
      }
    }
    this._logger?.info(`all contents restored!`);
    await this.end();
  }

  async truncateTables(db: string) {
    await this.switchDatabase(db);
    const tables = await this.rows<{
      schemaname: string;
      tablename: string;
    }>(`
      SELECT schemaname, tablename
      FROM pg_tables
      WHERE schemaname NOT IN (${pgQuoteStrings(this._skipSchemas)})
      ORDER BY 1,2
    `);
    const sql = tables.map((t) => `TRUNCATE TABLE ${t.schemaname}.${t.tablename} CASCADE;`).join('\n');
    await this.query(sql);
  }
}
