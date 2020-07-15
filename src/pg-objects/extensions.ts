import { Client } from 'pg';

export async function collectExtensions(client: Client) {
  const result = await client.query<{
    extname: string;
  }>(`
    SELECT extname FROM pg_extension WHERE extname <> 'plpgsql'
  `);
  return result.rows.map((row) => {
    return {
      name: row.extname,
      src: `CREATE EXTENSION IF NOT EXISTS "${row.extname}"`,
    };
  });
}
