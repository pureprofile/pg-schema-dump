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
  const schemas = assertStringArray(manifest.schemas, 'schemas', filePath);
  const tables = assertStringArray(manifest.tables, 'tables', filePath);
  const functions = assertStringArray(manifest.functions, 'functions', filePath);

  for (const table of tables) {
    const dotCount = table.split('.').length - 1;
    if (dotCount !== 1) {
      throw new Error(
        `scope file ${filePath}: "tables" entry "${table}" must be in "schema.table" form (exactly one ".")`
      );
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
