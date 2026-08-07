import { Client } from 'pg';
import { pgQuoteStrings, notExtensionOwned } from '../pg-helpers';
import { resolveScope, ResolvedScope } from '../scope';

export interface Attribute {
  table: string;
  name: string;
  type: string;
  isNotNull?: boolean;
  defaultValue: string | null;
  description: string;
  references?: Reference;
  isPrimaryKey: boolean;
}

export interface Reference {
  /**
   * Display only - never emit this as an identifier.
   *
   * It comes from `confrelid::regclass`, whose text form depends on the session
   * `search_path` (schema-qualified only when the schema is not on it) and which
   * quotes itself only when it has to, so its single dot is not a separator anything
   * may rely on. The executable foreign key DDL comes from `pg_get_constraintdef` in
   * `constraints.ts`; this feeds only the `references ...` breadcrumb comment in
   * `attributeSql`. Copy the `OwnedBy` shape in `sequences.ts` if a qualified name
   * ever needs to become SQL again.
   */
  table: string;
  attribute: Attribute;
}

export async function collectTables(
  client: Client,
  options: {
    skipSchemas: string[];
    scope?: ResolvedScope;
  }
) {
  const scope = options.scope || resolveScope();
  const result = await client.query<{
    schema: string;
    table: string;
    attributes: Attribute[];
  }>(`
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
                  r.contype = 'f' and
                  exists (
                    select 1 from pg_class rc join pg_namespace rn on rn.oid = rc.relnamespace
                    where rc.oid = r.confrelid and ${scope.tablePredicate('rn.nspname', 'rc.relname')}
                  )
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
    WHERE c.relkind = 'r'
      AND ${notExtensionOwned('pg_class', 'c.oid')}
      ${options.skipSchemas.length ? `AND n.nspname NOT IN (${pgQuoteStrings(options.skipSchemas)})` : ``}
      AND ${scope.tablePredicate('n.nspname', 'c.relname')}
    ORDER BY 2, 3
  `);
  return result.rows;
}
