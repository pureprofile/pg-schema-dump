import * as pg from 'pg';
import { pgQuoteStrings } from './pg-helpers';
import { log } from './utils';
import { parse as parsePgConnectionString } from 'pg-connection-string';
import { FsSchema } from './fs-schema';
import { unquoted } from './fs-schema-helpers';
import { collectConstraints } from './pg-objects/constraints';
import { uniq } from 'lodash';
import { collectIndexes } from './pg-objects/indexes';
import { collectExtensions } from './pg-objects/extensions';
import { collectTypes } from './pg-objects/types';
import { collectTables } from './pg-objects/tables';
import { collectViews } from './pg-objects/views';
import { collectFunctions } from './pg-objects/functions';
import { collectTriggers } from './pg-objects/triggers';
import { collectSequences, OwnedBy } from './pg-objects/sequences';
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
  private _scopeSummary: string;

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
    this._scopeSummary =
      `${(options.scope?.includeSchemas || []).length} schemas, ` +
      `${(options.scope?.includeTables || []).length} tables`;
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
      this._logger?.info(`scope active: ${this._scopeSummary}`);
    }

    await this.connect();
    if (!this._client) {
      throw new Error(`this.connect() should ensure client exists`);
    }
    // Collect everything first: per-table objects are merged into one file per
    // table, so nothing can be written until all of it is in hand.
    const [extensions, types, functions, indexes, sequences, tables, triggers, collectedViews, collectedConstraints] =
      await Promise.all([
        collectExtensions(this._client, { skipExtensions }),
        collectTypes(this._client, { skipSchemas, scope }),
        collectFunctions(this._client, { skipSchemas, skipFunctions, scope }),
        collectIndexes(this._client, { skipSchemas, scope }),
        collectSequences(this._client, { skipSchemas, scope }),
        collectTables(this._client, { skipSchemas, scope }),
        collectTriggers(this._client, { skipSchemas, scope }),
        collectViews(this._client, { skipSchemas, scope }),
        collectConstraints(this._client, { skipSchemas, scope }),
      ] as const);

    const views = collectedViews.views;
    const constraints = collectedConstraints.constraints;

    // What a scope left out, reported by the collectors that made the decision
    // rather than re-derived by a second set of queries that would have to be kept
    // in step with them by hand.
    if (scope.active) {
      for (const fk of collectedConstraints.droppedForeignKeys) {
        this._logger?.warn(
          `scope: dropped FK ${fk.schema}.${fk.table}.${fk.name} -> ${fk.target} (target out of scope)`
        );
      }
      for (const view of collectedViews.excluded) {
        this._logger?.warn(`scope: excluded view ${view.view} (depends on out-of-scope ${view.cause})`);
      }
    }

    await this.end();

    const tableKey = (schema: string, table: string) => `${schema}.${table}`;
    const byTable = <T extends { schema: string; table: string }>(items: T[]) => {
      const map: { [key: string]: T[] } = {};
      for (const item of items) {
        const key = tableKey(item.schema, unquoted(item.table));
        (map[key] = map[key] || []).push(item);
      }
      return map;
    };

    const indexesByTable = byTable(indexes);
    const triggersByTable = byTable(triggers);
    const constraintsByTable = byTable(constraints);

    // A sequence owned by a column belongs to that column's table: its
    // ALTER SEQUENCE ... OWNED BY has to run after the table exists, so it is
    // emitted inside the table's file rather than the sequence's own.
    const ownedSequencesByTable: { [key: string]: Array<{ schema: string; name: string; ownedBy: OwnedBy }> } = {};
    for (const sequence of sequences) {
      const ownedBy = sequence.ownedBy;
      if (!ownedBy) {
        continue;
      }
      const key = tableKey(ownedBy.schema, ownedBy.table);
      (ownedSequencesByTable[key] = ownedSequencesByTable[key] || []).push({
        schema: sequence.schema,
        name: sequence.name,
        ownedBy,
      });
    }

    extensions.map(fsSchema.writeExtension);
    types.map(fsSchema.writeType);
    functions.map(fsSchema.writeFunction);
    sequences.map(fsSchema.writeSequence);
    views.map(fsSchema.writeView);

    for (const table of tables) {
      const key = tableKey(table.schema, table.table);
      fsSchema.writeTable({
        ...table,
        constraints: (constraintsByTable[key] || []).filter((c) => c.type !== 'f'),
        indexes: indexesByTable[key] || [],
        triggers: triggersByTable[key] || [],
        ownedSequences: ownedSequencesByTable[key] || [],
      });
      fsSchema.writeForeignKeys({
        schema: table.schema,
        table: table.table,
        constraints: (constraintsByTable[key] || []).filter((c) => c.type === 'f'),
      });
    }

    const getSchema = <T extends { schema: string }>(arg: T) => arg.schema;
    uniq([
      ...types.map(getSchema),
      ...functions.map(getSchema),
      ...sequences.map(getSchema),
      ...tables.map(getSchema),
      ...views.map(getSchema),
      ...constraints.map(getSchema),
    ]).map((schema) => fsSchema.writeSchema({ schema }));

    this._logger?.info(`finished dump of: ${await this.getCurrentDatabase()}`);
  }

  async restoreSchema({ src }: { src: string }) {
    await this.connect();
    try {
      await this._restoreSchema({ src });
    } finally {
      // Always hand the connection back with validation restored, even on a failed
      // restore - otherwise the caller is left holding an open session with
      // check_function_bodies still off.
      try {
        await this._client?.query(`SET check_function_bodies = on`);
      } catch {
        // the session is already unusable; nothing to restore
      }
      await this.end();
    }
  }

  private async _restoreSchema({ src }: { src: string }) {
    const fsSchema = new FsSchema(src, this._logger);
    this._logger?.info(`reading contents from: ${src}`);

    // Functions are restored before the tables they may reference, so their
    // bodies must not be validated on creation.
    await this._client!.query(`SET check_function_bodies = off`);

    const fNames = await fsSchema.readDir();
    const lastError: { [fName: string]: Error } = {};
    // Files are ordered so one pass suffices, but chained views (a view selecting
    // from another view) can still need a retry. Requeue a failing file and give
    // up only once a full cycle completes with nothing succeeding.
    let sinceLastProgress = 0;

    while (fNames.length > 0) {
      const fName = fNames[0];
      const fContents = await fsSchema.read(fName);

      try {
        await this._client!.query(fContents);
        fNames.shift();
        delete lastError[fName];
        sinceLastProgress = 0;
      } catch (err) {
        lastError[fName] = err as Error;
        fNames.shift();
        fNames.push(fName);
        sinceLastProgress += 1;
        if (sinceLastProgress > fNames.length) {
          break;
        }
      }
    }

    if (fNames.length > 0) {
      const report = uniq(fNames)
        .map((fName) => `  - ${fName}: ${lastError[fName] ? lastError[fName].message : 'unknown error'}`)
        .join('\n');
      const error = new Error(`restoreSchema: ${uniq(fNames).length} file(s) could not be applied:\n${report}`);
      this._logger?.error(error.message);
      throw error;
    }

    this._logger?.info(`all contents restored!`);
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
