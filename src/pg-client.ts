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

const DEFAULT_SCHEMAS_TO_SKIP: string[] = ['pg_catalog', 'information_schema'];
const DEFAULT_FUNCTIONS_TO_SKIP: string[] = [];

export class PgClient {
  private _clientConfig: pg.ClientConfig;
  private _client: pg.Client | null = null;
  private _logger: typeof log | null;
  private _skipSchemas: string[];
  private _skipFunctions: string[];

  constructor(
    config: string | pg.ClientConfig,
    options: {
      logger?: typeof log | null;
      skipSchemas?: string[];
      skipFunctions?: string[];
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

    await this.connect();
    if (!this._client) {
      throw new Error(`this.connect() should ensure client exists`);
    }
    const [, , functions, indexes, sequences, tables, triggers, views] = await Promise.all([
      collectExtensions(this._client).then(all(fsSchema.writeExtension)),
      collectTypes(this._client).then(all(fsSchema.writeType)),
      collectFunctions(this._client, { skipSchemas, skipFunctions }).then(all(fsSchema.writeFunction)),
      collectIndexes(this._client, { skipSchemas }).then(all(fsSchema.writeIndex)),
      collectSequences(this._client).then(all(fsSchema.writeSequence)),
      collectTables(this._client, { skipSchemas }).then(all(fsSchema.writeTable)),
      collectTriggers(this._client, { skipSchemas }).then(all(fsSchema.writeTrigger)),
      collectViews(this._client, { skipSchemas }).then(all(fsSchema.writeView)),
    ] as const);
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
