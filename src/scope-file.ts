import * as fs from 'fs-extra';
import { ScopeOptions } from './scope';

interface ScopeManifest {
  schemas?: unknown;
  tables?: unknown;
  functions?: unknown;
}

function assertStringArray(value: unknown, field: string, filePath: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`scope file ${filePath}: "${field}" must be an array of strings`);
  }
  return value as string[];
}

export function loadScopeFile(filePath: string): ScopeOptions {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`scope file ${filePath}: could not be read: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`scope file ${filePath}: not valid JSON: ${(err as Error).message}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`scope file ${filePath}: must contain a JSON object`);
  }

  const manifest = parsed as ScopeManifest;

  // Reject unknown keys rather than ignoring them. A typo like "table" for
  // "tables" would otherwise leave the scope empty, which means inactive, which
  // means silently dumping the entire database instead of the intended subset.
  // `$comment`-style keys are allowed so a manifest can document itself.
  const known = ['schemas', 'tables', 'functions'];
  const unknown = Object.keys(parsed as Record<string, unknown>).filter(
    (key) => known.indexOf(key) === -1 && key.indexOf('$') !== 0 && key.indexOf('//') !== 0
  );
  if (unknown.length > 0) {
    throw new Error(
      `scope file ${filePath}: unknown key(s) ${unknown.map((k) => `"${k}"`).join(', ')}; ` +
        `expected only ${known.map((k) => `"${k}"`).join(', ')}`
    );
  }

  const schemas = assertStringArray(manifest.schemas, 'schemas', filePath);
  const tables = assertStringArray(manifest.tables, 'tables', filePath);
  const functions = assertStringArray(manifest.functions, 'functions', filePath);

  // Both are "schema.name"; a bare name would silently match nothing.
  for (const field of [
    { name: 'tables', entries: tables, shape: 'schema.table' },
    { name: 'functions', entries: functions, shape: 'schema.function' },
  ]) {
    for (const entry of field.entries) {
      if (entry.split('.').length - 1 !== 1) {
        throw new Error(
          `scope file ${filePath}: "${field.name}" entry "${entry}" must be in "${field.shape}" form (exactly one ".")`
        );
      }
    }
  }

  return {
    includeSchemas: schemas,
    includeTables: tables,
    includeFunctions: functions,
  };
}

export function mergeScope(...parts: Array<ScopeOptions | undefined>): ScopeOptions {
  const includeSchemas: string[] = [];
  const includeTables: string[] = [];
  const includeFunctions: string[] = [];

  for (const part of parts) {
    if (!part) {
      continue;
    }
    includeSchemas.push(...(part.includeSchemas || []));
    includeTables.push(...(part.includeTables || []));
    includeFunctions.push(...(part.includeFunctions || []));
  }

  return {
    includeSchemas: Array.from(new Set(includeSchemas)),
    includeTables: Array.from(new Set(includeTables)),
    includeFunctions: Array.from(new Set(includeFunctions)),
  };
}
