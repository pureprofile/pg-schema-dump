import { resolveScope } from '../../src/scope';
import { loadScopeFile, mergeScope } from '../../src/scope-file';
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
  expect(scope.schemaPredicate('n.nspname')).toBe('true');
  expect(scope.functionPredicate('n.nspname', 'p.proname')).toBe('false');
});

test('resolveScope with empty arrays is inactive', () => {
  const scope = resolveScope({ includeSchemas: [], includeTables: [], includeFunctions: [] });
  expect(scope.active).toBe(false);
  expect(scope.tablePredicate('n.nspname', 'c.relname')).toBe('true');
});

test('resolveScope schemas-only', () => {
  const scope = resolveScope({ includeSchemas: ['fraud', 'topup'] });
  expect(scope.active).toBe(true);
  expect(scope.tablePredicate('n.nspname', 'c.relname')).toBe("(n.nspname = ANY(ARRAY['fraud', 'topup']::text[]))");
  expect(scope.schemaPredicate('n.nspname')).toBe("(n.nspname = ANY(ARRAY['fraud', 'topup']::text[]))");
});

test('resolveScope tables-only', () => {
  const scope = resolveScope({ includeTables: ['public.panel', 'public.account'] });
  expect(scope.active).toBe(true);
  expect(scope.tablePredicate('n.nspname', 'c.relname')).toBe(
    "((n.nspname || '.' || c.relname) = ANY(ARRAY['public.panel', 'public.account']::text[]))"
  );
  expect(scope.schemaPredicate('n.nspname')).toBe("(n.nspname = ANY(ARRAY['public']::text[]))");
});

test('resolveScope mixed schemas + tables', () => {
  const scope = resolveScope({ includeSchemas: ['fraud', 'topup'], includeTables: ['public.panel', 'public.account'] });
  expect(scope.tablePredicate('n.nspname', 'c.relname')).toBe(
    "(n.nspname = ANY(ARRAY['fraud', 'topup']::text[]) OR (n.nspname || '.' || c.relname) = ANY(ARRAY['public.panel', 'public.account']::text[]))"
  );
});

test('resolveScope functionPredicate uses includeFunctions escape hatch', () => {
  const scope = resolveScope({ includeTables: ['public.panel'], includeFunctions: ['public.gen_id'] });
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
    JSON.stringify({ schemas: ['fraud', 'topup'], tables: ['public.panel', 'public.account'], functions: [] })
  );
  expect(loadScopeFile(filePath)).toEqual({
    includeSchemas: ['fraud', 'topup'],
    includeTables: ['public.panel', 'public.account'],
    includeFunctions: [],
  });
});

test('loadScopeFile rejects a bare table name, naming the offender and the file path', () => {
  const filePath = writeTempFile(JSON.stringify({ tables: ['panel'] }));
  expect(() => loadScopeFile(filePath)).toThrow(filePath);
  expect(() => loadScopeFile(filePath)).toThrow('panel');
});

test('loadScopeFile rejects non-string entries, naming the file path', () => {
  const filePath = writeTempFile(JSON.stringify({ schemas: ['fraud', 5] }));
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
    mergeScope({ includeSchemas: ['fraud'], includeTables: ['public.panel'] }, undefined, {
      includeSchemas: ['fraud', 'topup'],
      includeFunctions: ['public.gen_id'],
    })
  ).toEqual({
    includeSchemas: ['fraud', 'topup'],
    includeTables: ['public.panel'],
    includeFunctions: ['public.gen_id'],
  });
});

test('mergeScope with no parts returns empty arrays', () => {
  expect(mergeScope()).toEqual({ includeSchemas: [], includeTables: [], includeFunctions: [] });
});
