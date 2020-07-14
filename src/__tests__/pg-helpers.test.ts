import { sqlGetTableReferences } from '../pg-helpers';

test('sqlGetTableReferences', () => {
  expect(
    sqlGetTableReferences(`
    create table acem.acem_config (
      id bigint not null default nextval('acem.acem_config_id_seq'::regclass) primary key,
      data_source_id bigint not null references data_source,
      account_id bigint not null,
      acem_code character varying(10) not null,
      acem_name character varying(100) not null,
      domain text,
      instance_id bigint not null,
      panel_id bigint not null,
      platform_id bigint not null,
      tenant_id bigint not null
    );  
  `)
  ).toEqual(['data_source']);
});
