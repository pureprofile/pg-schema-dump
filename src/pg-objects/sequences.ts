import { Client } from 'pg';

export async function collectSequences(client: Client) {
  const result = await client.query<{
    sequence_schema: string;
    sequence_name: string;
    data_type: string;
    numeric_precision: number;
    numeric_precision_radix: number;
    numeric_scale: number;
    start_value: string;
    minimum_value: string;
    maximum_value: string;
    increment: string;
    cycle_option: string;
  }>(`
    SELECT
      sequence_schema,
      sequence_name,
      data_type,
      numeric_precision,
      numeric_precision_radix,
      numeric_scale,
      start_value,
      minimum_value,
      maximum_value,
      increment,
      cycle_option
    FROM information_schema.sequences
  `);
  return result.rows.map((row) => {
    return {
      schema: row.sequence_schema,
      name: row.sequence_name,
      src: `
        CREATE SEQUENCE ${row.sequence_schema}.${row.sequence_name}
        INCREMENT ${row.increment}
        MINVALUE ${row.minimum_value}
        MAXVALUE ${row.maximum_value}
      `.trim(),
    };
  });
}
