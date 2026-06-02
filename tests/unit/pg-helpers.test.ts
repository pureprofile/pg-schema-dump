import {
  sqlGetFunctionReferences,
  pgQuoteString,
  pgQuoteStrings,
  pgStringArray,
  all,
  findAndShiftFunctionReferences,
} from '../../src/pg-helpers';

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

// ---------------------------------------------------------------------------
// pgQuoteString
// ---------------------------------------------------------------------------
test('pgQuoteString wraps string in single quotes', () => {
  expect(pgQuoteString('abc')).toBe("'abc'");
});

test('pgQuoteString returns non-string values as-is', () => {
  expect(pgQuoteString(5 as any)).toBe(5 as any);
});

// ---------------------------------------------------------------------------
// pgQuoteStrings
// ---------------------------------------------------------------------------
test('pgQuoteStrings wraps each element', () => {
  expect(pgQuoteStrings(['a', 'b'])).toEqual(["'a'", "'b'"]);
});

// ---------------------------------------------------------------------------
// pgStringArray
// ---------------------------------------------------------------------------
test('pgStringArray parses postgres array literal', () => {
  expect(pgStringArray('{a,b,c}')).toEqual(['a', 'b', 'c']);
});

// ---------------------------------------------------------------------------
// all
// ---------------------------------------------------------------------------
test('all maps a function over an array', () => {
  expect(all((x: number) => x * 2)([1, 2, 3])).toEqual([2, 4, 6]);
});

// ---------------------------------------------------------------------------
// findAndShiftFunctionReferences
// ---------------------------------------------------------------------------
test('findAndShiftFunctionReferences: shifts matching function file to front', () => {
  const fNames = ['table.public.t.sql', 'function.public.gen_id.sql'];
  const fContents = 'create table public.t ( id uuid default gen_id() )';
  const result = findAndShiftFunctionReferences('table.public.t.sql', fContents, fNames);
  expect(result).toBe(true);
  expect(fNames[0]).toBe('function.public.gen_id.sql');
});

test('findAndShiftFunctionReferences: returns false for non-table file', () => {
  const fNames = ['function.public.gen_id.sql', 'function.public.other.sql'];
  const result = findAndShiftFunctionReferences('function.public.gen_id.sql', 'some sql', fNames);
  expect(result).toBe(false);
});

test('findAndShiftFunctionReferences: returns false when only builtin refs (now)', () => {
  const fNames = ['table.public.t.sql', 'function.public.now.sql'];
  const fContents = 'create table public.t ( created_at timestamp default now() )';
  const result = findAndShiftFunctionReferences('table.public.t.sql', fContents, fNames);
  expect(result).toBe(false);
});

test('findAndShiftFunctionReferences: returns false when referenced function file not in fNames', () => {
  const fNames = ['table.public.t.sql'];
  const fContents = 'create table public.t ( id uuid default gen_id() )';
  const result = findAndShiftFunctionReferences('table.public.t.sql', fContents, fNames);
  expect(result).toBe(false);
});
