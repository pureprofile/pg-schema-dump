import { Sequelize } from 'sequelize';
import { Attribute } from './types';
import { log } from './utils';

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

export class DbSchema {
  public db: Sequelize;

  constructor(url: string, private logger: typeof log | null) {
    this.db = new Sequelize(url, { logging: false });
  }

  getDatabaseName() {
    return this.db.getDatabaseName();
  }

  tablesOrViews(isTable = true) {
    const kind = isTable ? 'r' : 'v';
    return this.db.query(
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
        c.relkind = :kind and
        n.nspname not in (:SkipSchemaNames)
      order by
        2, 3;
    `,
      { type: 'SELECT', replacements: { kind, SkipSchemaNames } }
    ) as Promise<
      Array<{
        schema: string;
        table: string;
        attributes: Attribute[];
      }>
    >;
  }

  async tables() {
    return this.tablesOrViews(true);
  }

  async functions() {
    return this.db.query(
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
        p.proname not in (:SkipFunctionNames) and
        n.nspname not in (:SkipSchemaNames) and
        probin is null;
    `,
      { type: 'SELECT', replacements: { SkipFunctionNames, SkipSchemaNames } }
    ) as Promise<
      Array<{
        schema: string;
        name: string;
        src: string;
      }>
    >;
  }

  async indexes() {
    return this.db.query(
      `
      select
        schemaname "schema",
        tablename "table",
        indexname "name",
        indexdef || E'\\n' "src"
      from pg_indexes
      where
        schemaname not in (:SkipSchemaNames);
    `,
      { type: 'SELECT', replacements: { SkipSchemaNames } }
    ) as Promise<
      Array<{
        schema: string;
        table: string;
        name: string;
        src: string;
      }>
    >;
  }

  async views() {
    return this.db.query(
      `
      SELECT
        v.schemaname as schema,
        v.viewname as name,
        v.definition as src
      FROM pg_views v
      WHERE schemaname NOT IN (:SkipSchemaNames);
    `,
      { type: 'SELECT', replacements: { SkipSchemaNames } }
    ) as Promise<
      Array<{
        schema: string;
        name: string;
        src: string;
      }>
    >;
  }

  async triggers() {
    return this.db.query(
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
        n.nspname not in (
          :SkipSchemaNames
        )
    `,
      { type: 'SELECT', replacements: { SkipSchemaNames } }
    ) as Promise<
      Array<{
        schema: string;
        table: string;
        name: string;
        src: string;
      }>
    >;
  }

  close() {
    this.db.close().catch((err) => {
      this.logger?.error(`error closing the db connection: ${err}`);
    });
  }
}
