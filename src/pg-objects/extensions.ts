import type { Client } from 'pg';

import { pgQuoteStrings } from '../pg-helpers';

export async function collectExtensions(
  client: Client,
  options: {
    skipExtensions?: string[];
  } = {}
) {
  const skipExtensions = options.skipExtensions || [];
  const result = await client.query<{
    extname: string;
  }>(`
    SELECT extname FROM pg_extension
    WHERE extname <> 'plpgsql'
      ${skipExtensions.length ? `AND extname NOT IN (${pgQuoteStrings(skipExtensions)})` : ``}
  `);
  return result.rows.map((row) => ({
    name: row.extname,
    src: `CREATE EXTENSION IF NOT EXISTS "${row.extname}"`,
  }));
}
