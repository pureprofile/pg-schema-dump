import { resolveScope } from '../../src/scope';
import { loadScopeFile, mergeScope, validateScope } from '../../src/scope-file';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

// ---------------------------------------------------------------------------
// resolveScope
// ---------------------------------------------------------------------------

test('resolveScope with no options is inactive and every predicate is permissive/inert', () => {
  const scope = resolveScope();
  expect(scope.active).toBe(false);
  expect(scope.tablePredicate('n.nspname', 'c.relname')).toBe('true');
  expect(scope.functionPredicate('n.nspname', 'p.proname')).toBe('false');
});

test('resolveScope with empty arrays is inactive', () => {
  const scope = resolveScope({ includeSchemas: [], includeTables: [], includeFunctions: [] });
  expect(scope.active).toBe(false);
  expect(scope.tablePredicate('n.nspname', 'c.relname')).toBe('true');
});

test('resolveScope schemas-only', () => {
  const scope = resolveScope({ includeSchemas: ['billing', 'archive'] });
  expect(scope.active).toBe(true);
  expect(scope.tablePredicate('n.nspname', 'c.relname')).toBe("(n.nspname = ANY(ARRAY['billing', 'archive']::text[]))");
});

test('resolveScope tables-only', () => {
  const scope = resolveScope({ includeTables: ['public.orders', 'public.customers'] });
  expect(scope.active).toBe(true);
  expect(scope.tablePredicate('n.nspname', 'c.relname')).toBe(
    "((n.nspname || '.' || c.relname) = ANY(ARRAY['public.orders', 'public.customers']::text[]))"
  );
  // naming public.orders does not opt the whole public schema in - that distinction
  // is what stops one table dragging in every sequence and enum in its schema
  expect(scope.includedSchemaPredicate('n.nspname')).toBe('false');
});

test('resolveScope mixed schemas + tables', () => {
  const scope = resolveScope({
    includeSchemas: ['billing', 'archive'],
    includeTables: ['public.orders', 'public.customers'],
  });
  expect(scope.tablePredicate('n.nspname', 'c.relname')).toBe(
    "(n.nspname = ANY(ARRAY['billing', 'archive']::text[]) OR (n.nspname || '.' || c.relname) = ANY(ARRAY['public.orders', 'public.customers']::text[]))"
  );
});

test('resolveScope functionPredicate uses includeFunctions escape hatch', () => {
  const scope = resolveScope({ includeTables: ['public.orders'], includeFunctions: ['public.gen_id'] });
  expect(scope.functionPredicate('n.nspname', 'p.proname')).toBe(
    "((n.nspname || '.' || p.proname) = ANY(ARRAY['public.gen_id']::text[]))"
  );
});

test('resolveScope escapes embedded single quotes in values', () => {
  const scope = resolveScope({ includeSchemas: [`fra'ud`] });
  expect(scope.tablePredicate('n.nspname', 'c.relname')).toBe("(n.nspname = ANY(ARRAY['fra''ud']::text[]))");
});

// ---------------------------------------------------------------------------
// loadScopeFile
// ---------------------------------------------------------------------------

function writeTempFile(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-schema-dump-scope-'));
  const filePath = path.join(dir, 'scope.json');
  fs.writeFileSync(filePath, contents);
  return filePath;
}

test('loadScopeFile maps manifest fields to ScopeOptions', () => {
  const filePath = writeTempFile(
    JSON.stringify({ schemas: ['billing', 'archive'], tables: ['public.orders', 'public.customers'], functions: [] })
  );
  expect(loadScopeFile(filePath)).toEqual({
    includeSchemas: ['billing', 'archive'],
    includeTables: ['public.orders', 'public.customers'],
    includeFunctions: [],
  });
});

test('loadScopeFile rejects a bare table name, naming the offender and the file path', () => {
  const filePath = writeTempFile(JSON.stringify({ tables: ['orders'] }));
  expect(() => loadScopeFile(filePath)).toThrow(filePath);
  expect(() => loadScopeFile(filePath)).toThrow('orders');
});

test('loadScopeFile rejects non-string entries, naming the file path', () => {
  const filePath = writeTempFile(JSON.stringify({ schemas: ['billing', 5] }));
  expect(() => loadScopeFile(filePath)).toThrow(filePath);
});

test('loadScopeFile rejects invalid JSON, naming the file path', () => {
  const filePath = writeTempFile('{ not valid json');
  expect(() => loadScopeFile(filePath)).toThrow(filePath);
});

test('loadScopeFile rejects a non-object JSON document, naming the file path', () => {
  const filePath = writeTempFile(JSON.stringify(['a', 'b']));
  expect(() => loadScopeFile(filePath)).toThrow(filePath);
});

test('loadScopeFile throws naming the file path when the file cannot be read', () => {
  const missingPath = path.join(os.tmpdir(), 'pg-schema-dump-scope-does-not-exist', 'scope.json');
  expect(() => loadScopeFile(missingPath)).toThrow(missingPath);
});

// ---------------------------------------------------------------------------
// mergeScope
// ---------------------------------------------------------------------------

test('mergeScope combines and dedupes parts, ignoring undefined', () => {
  expect(
    mergeScope({ includeSchemas: ['billing'], includeTables: ['public.orders'] }, undefined, {
      includeSchemas: ['billing', 'archive'],
      includeFunctions: ['public.gen_id'],
    })
  ).toEqual({
    includeSchemas: ['billing', 'archive'],
    includeTables: ['public.orders'],
    includeFunctions: ['public.gen_id'],
  });
});

test('mergeScope with no parts returns empty arrays', () => {
  expect(mergeScope()).toEqual({ includeSchemas: [], includeTables: [], includeFunctions: [] });
});

// ---------------------------------------------------------------------------
// validateScope
// ---------------------------------------------------------------------------
// CLI flags reach resolveScope without passing through loadScopeFile, so they need
// the same check or a bare name activates scoping and matches nothing.
test('validateScope rejects a table without a schema', () => {
  expect(() => validateScope({ includeTables: ['orders'] }, 'scope options')).toThrow('orders');
});

test('validateScope rejects a function without a schema', () => {
  expect(() => validateScope({ includeFunctions: ['gen_id'] }, 'scope options')).toThrow('gen_id');
});

// Schemas need the opposite check to tables: a qualified entry is a table pasted
// into the wrong list, which activates the scope and then matches no schema at all.
test('validateScope rejects a qualified name in schemas', () => {
  expect(() => validateScope({ includeSchemas: ['public.orders'] }, 'scope options')).toThrow('public.orders');
});

test('validateScope rejects an empty schema entry', () => {
  expect(() => validateScope({ includeSchemas: ['  '] }, 'scope options')).toThrow('empty');
});

test('validateScope passes a well-formed scope through unchanged', () => {
  const scope = { includeSchemas: ['billing'], includeTables: ['public.orders'], includeFunctions: ['public.gen_id'] };
  expect(validateScope(scope, 'scope options')).toEqual(scope);
});
