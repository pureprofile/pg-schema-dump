import { sqlGetFunctionReferences } from '../pg-helpers';

const tableSql = `
create table my.table (
  id bigint not null default nextval('my.id_seq'::regclass) primary key,
  created_at timestamp with time zone not null default NOW(),
  data_source_id bigint not null references data_source,
  account_id bigint not null references account_schema.account,
  account_user_id bigint not null references account_schema."user",
  db_uuid uuid not null default uuid_generate_v4(),
  user_id bigint not null references "user"
);
`;

test('sqlGetFunctionReferences', () => {
  expect(sqlGetFunctionReferences(tableSql)).toEqual(['uuid_generate_v4']);
});
