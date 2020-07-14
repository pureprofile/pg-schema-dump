import { sqlGetTableReferences } from '../pg-helpers';

test('sqlGetTableReferences', () => {
  expect(
    sqlGetTableReferences(`
    create table my.table (
      id bigint not null default nextval('my.id_seq'::regclass) primary key,
      data_source_id bigint not null references data_source,
      account_id bigint not null references account
    );  
  `)
  ).toEqual(['data_source', 'account']);
});
