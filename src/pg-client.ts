import * as pg from 'pg';
import { Attribute } from './types';
import {
  pgQuoteString,
  pgQuoteStrings,
  findAndShiftTableReferences,
  findAndShiftFunctionReferences,
} from './pg-helpers';
import { log } from './utils';
import { parse as parsePgConnectionString } from 'pg-connection-string';
import { FsSchema } from './fs-schema';
import { uniq } from 'lodash';

const SkipSchemaNames = ['pg_catalog', 'information_schema', 'scratch'];

const SkipFunctionNames = [
  'earth',
  'earth_box',
  'earth_distance',
  'gc_to_sec',
  'latitude',
  'll_to_earth',
  'longitude',
  'sec_to_gc',
];

export class PgClient {
  private _clientConfig: pg.ClientConfig;
  private _client: pg.Client;
  private _logger: typeof log | null;

  constructor(
    config: string | pg.ClientConfig,
    options: {
      logger?: typeof log | null;
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
    this._client = new pg.Client(this._clientConfig);
    this._logger = options.logger !== undefined ? options.logger : log;
  }

  connect() {
    return this._client.connect();
  }

  end() {
    return this._client.end();
  }

  query<T>(query: string) {
    return this._client.query<T>(query);
  }

  getDatabases() {
    return this._client
      .query<{
        datname: string;
      }>(`SELECT datname FROM pg_database`)
      .then((res) => res.rows.map((row) => row.datname));
  }

  async databaseExists(db: string) {
    const databases = await this.getDatabases();
    return databases.some((x) => x === db);
  }

  createDatabase(db: string) {
    return this._client.query(`CREATE DATABASE "${db}"`);
  }

  dropDatabase(db: string) {
    return this._client.query(`DROP DATABASE "${db}"`);
  }

  async switchDatabase(db: string) {
    await this.end();
    this._clientConfig.database = db;
    this._client = new pg.Client(this._clientConfig);
    await this.connect();
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
    const schemas: string[] = [];
    for (const { name } of await this.extensions()) {
      fsSchema.writeExtension({ name });
    }
    for (const { schema, name, src } of await this.functions()) {
      schemas.push(schema);
      fsSchema.writeFunction({ schema, name, src });
    }
    for (const { schema, table, name, src } of await this.indexes()) {
      schemas.push(schema);
      fsSchema.writeIndex({ schema, table, name, src });
    }
    for (const { schema, name, src } of await this.views()) {
      schemas.push(schema);
      fsSchema.writeView({ schema, name, src });
    }
    for (const { schema, table, name, src } of await this.triggers()) {
      schemas.push(schema);
      fsSchema.writeTrigger({ schema, table, name, src });
    }
    for (const { schema, table, attributes } of await this.tables()) {
      schemas.push(schema);
      fsSchema.writeTable({ schema, table, attributes });
    }
    for (const { schema, name, src } of await this.sequences()) {
      schemas.push(schema);
      fsSchema.writeSequence({ schema, name, src });
    }
    for (const schema of uniq(schemas)) {
      fsSchema.writeSchema({ schema });
    }
  }

  async restoreSchema({ src }: { src: string }) {
    const fsSchema = new FsSchema(src, this._logger);
    this._logger?.info(`reading contents from: ${src}`);
    const fNames = await fsSchema.readDir();
    while (fNames.length > 0) {
      const fName = fNames[0];
      const fContents = await fsSchema.read(fName);

      // handle references
      if (findAndShiftTableReferences(fName, fContents, fNames)) {
        continue;
      }
      if (findAndShiftFunctionReferences(fName, fContents, fNames)) {
        continue;
      }

      try {
        await this._client.query(fContents);
        // remove the file if it was processed without error
        fNames.shift();
      } catch (err) {
        this._logger?.error(`error processing file ${fName}: ${(err as Error).stack || err}`);
        throw err;
      }
    }
    this._logger?.info(`all contents restored!`);
  }

  async getDatabaseName() {
    const result = await this._client.query<{ dbName: string }>(`SELECT current_database() AS "dbName"`);
    const dbName = result.rows[0].dbName;
    return dbName;
  }

  async extensions() {
    const result = await this._client.query<{
      extname: string;
    }>(`
      SELECT extname FROM pg_extension
    `);
    return result.rows.map((row) => {
      return {
        name: row.extname,
      };
    });
  }

  async tablesOrViews(isTable = true) {
    const kind = isTable ? 'r' : 'v';
    const result = await this._client.query<{
      schema: string;
      table: string;
      attributes: Attribute[];
    }>(
      `
      select
        n.nspname "schema",
        c.relname "table",
        (
          select
            jsonb_agg(t.attribute)
          from (
            select
              jsonb_build_object(
                'name', a.attname,
                'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
                'defaultValue', (
                  select
                    substring(pg_catalog.pg_get_expr(d.adbin, d.adrelid) for 128)
                  from
                    pg_catalog.pg_attrdef d
                  where
                    d.adrelid = a.attrelid and
                    d.adnum = a.attnum and
                    a.atthasdef
                ),
                'isNotNull', a.attnotnull,
                'isPrimaryKey', exists (
                  select
                    1
                  from
                    pg_constraint c2
                  where
                    c2.conrelid = c.oid and
                    c2.conkey = array[a.attnum] and
                    c2.contype = 'p'
                ),
                'description', pg_catalog.col_description(a.attrelid, a.attnum),
                'references', (
                  select
                    jsonb_build_object(
                      'table', r.confrelid::regclass,
                      'attribute', (
                        select
                          jsonb_build_object(
                            'name', a2.attname,
                            'isPrimaryKey', exists (
                              select
                                1
                              from
                                pg_constraint c2
                              where
                                c2.conrelid = a2.attrelid and
                                c2.conkey = array[a2.attnum] and
                                c2.contype = 'p'
                            )
                          ) info
                        from
                          pg_attribute a2
                        where
                          a2.attnum = r.confkey[1] and
                          a2.attrelid = r.confrelid
                      )
                    )
                  from
                    pg_catalog.pg_constraint r
                  where
                    r.conrelid = c.oid and
                    r.conkey = array[a.attnum] and
                    array_length(r.confkey, 1) = 1 and -- We want just single column refs
                    r.contype = 'f'
                  limit 1
                )
              ) "attribute"
            from pg_catalog.pg_attribute a
            where
              a.attrelid = c.oid and
              a.attnum > 0 and
              not a.attisdropped
            order by
              a.attnum
          ) t
        ) "attributes"
      from pg_catalog.pg_class c
      left join pg_catalog.pg_namespace n on
        n.oid = c.relnamespace
      where
        c.relkind = ${pgQuoteString(kind)} and
        n.nspname not in (${pgQuoteStrings(SkipSchemaNames)})
      order by
        2, 3;
    `
    );
    return result.rows;
  }

  async tables() {
    return this.tablesOrViews(true);
  }

  async functions() {
    const result = await this._client.query<{
      schema: string;
      name: string;
      src: string;
    }>(
      `
      select
        n.nspname "schema",
        p.proname "name",
        pg_get_functiondef(p.oid) src
      from pg_proc p
      join pg_namespace n on
        n.oid = p.pronamespace
      where
        p.proisagg = false and
        p.proname not in (${pgQuoteStrings(SkipFunctionNames)}) and
        n.nspname not in (${pgQuoteStrings(SkipSchemaNames)}) and
        probin is null;
    `
    );
    return result.rows;
  }

  async indexes() {
    const result = await this._client.query<{
      schema: string;
      table: string;
      name: string;
      src: string;
    }>(
      `
      select
        schemaname "schema",
        tablename "table",
        indexname "name",
        indexdef || E'\\n' "src"
      from pg_indexes
      where
        schemaname not in (${pgQuoteStrings(SkipSchemaNames)});
    `
    );
    return result.rows;
  }

  async views() {
    const result = await this._client.query<{
      schema: string;
      name: string;
      src: string;
    }>(
      `
      SELECT
        v.schemaname as schema,
        v.viewname as name,
        v.definition as src
      FROM pg_views v
      WHERE schemaname NOT IN (${pgQuoteStrings(SkipSchemaNames)});
    `
    );
    return result.rows;
  }

  async triggers() {
    const result = await this._client.query<{
      schema: string;
      table: string;
      name: string;
      src: string;
    }>(
      `
      select
        n.nspname "schema",
        t.tgrelid::regclass::text "table",
        t.tgname "name",
        pg_get_triggerdef(t.oid) "src"
      from
        pg_trigger t
      join pg_class c on
        c.oid = tgrelid
      join pg_namespace n on
        n.oid = c.relnamespace
      where
        not t.tgisinternal and
        t.tgenabled = 'O' and
        n.nspname not in (${pgQuoteStrings(SkipSchemaNames)})
    `
    );
    return result.rows;
  }

  async sequences() {
    const result = await this._client.query<{
      sequence_schema: string;
      sequence_name: string;
      data_type: string;
      numeric_precision: number;
      numeric_precision_radix: number;
      numeric_scale: number;
      start_value: string;
      minimum_value: string;
      maximum_value: string;
      increment: string;
      cycle_option: string;
    }>(
      `
      SELECT
        sequence_schema,
        sequence_name,
        data_type,
        numeric_precision,
        numeric_precision_radix,
        numeric_scale,
        start_value,
        minimum_value,
        maximum_value,
        increment,
        cycle_option
      FROM information_schema.sequences
      `
    );
    return result.rows.map((row) => {
      return {
        schema: row.sequence_schema,
        name: row.sequence_name,
        src: `
          CREATE SEQUENCE ${row.sequence_schema}.${row.sequence_name}
          INCREMENT ${row.increment}
          MINVALUE ${row.minimum_value}
          MAXVALUE ${row.maximum_value}
        `.trim(),
      };
    });
  }
}
