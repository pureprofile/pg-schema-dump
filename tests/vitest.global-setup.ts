import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PostgreSqlContainer } from '@testcontainers/postgresql';

let container: StartedPostgreSqlContainer | undefined;

export async function setup() {
  // Allow CI / local override with an external Postgres.
  if (process.env.TEST_DB_HOST) {
    return;
  }

  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('pg-schema-dump-test')
    .withUsername('postgres')
    .withPassword('postgres')
    .withCommand(['postgres', '-c', 'fsync=off', '-c', 'synchronous_commit=off', '-c', 'full_page_writes=off'])
    .withStartupTimeout(120_000)
    .start();

  process.env.TEST_DB_HOST = container.getHost();
  process.env.TEST_DB_PORT = String(container.getPort());
  process.env.TEST_DB_USER = 'postgres';
  process.env.TEST_DB_PASSWORD = 'postgres';
}

export async function teardown() {
  await container?.stop();
}
