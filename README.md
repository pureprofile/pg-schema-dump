# pg-schema-dump

`@pureprofile/pg-schema-dump` dumps a PostgreSQL schema into many small, individually-named `.sql` files so a schema becomes **text-comparable and diffable**.

Instead of one monolithic dump, every object (table, function, view, index, sequence, trigger, type, extension, foreign key) is written to its own file with a deterministic name and normalized SQL. Two databases can then be compared with a plain `diff` or committed to git to track schema drift over time. It can also restore a dump back into a database.

## Why

`pg_dump` output is ordered and formatted in ways that make diffing two schemas painful. This tool produces **byte-identical output for identical schemas**: collectors order rows in SQL, columns are sorted deterministically, and SQL is normalized. The result is a directory you can `diff -r`, check into git, or feed back into an empty database.

## Installation

Global CLI:

```bash
npm install -g @pureprofile/pg-schema-dump
```

As a library:

```bash
npm install @pureprofile/pg-schema-dump
# or: pnpm add @pureprofile/pg-schema-dump
```

## CLI usage

```bash
pg-schema-dump --url <connection-string> [--out <dir>]
```

| Option  | Required | Description                                           |
| ------- | -------- | ----------------------------------------------------- |
| `--url` | yes      | PostgreSQL connection string to the database to dump. |
| `--out` | no       | Directory to write the dump into. See default below.  |

When `--out` is omitted, output goes to `pg-schema-dump/<NODE_ENV>/<dbName>` (where `NODE_ENV` defaults to `development` and `dbName` is read from the connection).

### Examples

Dump a database into an explicit directory:

```bash
pg-schema-dump \
  --url postgres://user:pass@db.example.com:5432/mydb \
  --out ./schema/mydb
```

Dump using the default output location (`./pg-schema-dump/development/mydb`):

```bash
pg-schema-dump --url postgres://user:pass@localhost/mydb
```

Compare the schemas of two databases:

```bash
pg-schema-dump --url postgres://user:pass@host-a/app --out ./a
pg-schema-dump --url postgres://user:pass@host-b/app --out ./b
diff -r ./a ./b
```

## Programmatic usage

The package exports a single class, `PgClient`.

```ts
import { PgClient } from '@pureprofile/pg-schema-dump';

// from a connection string...
const client = new PgClient('postgres://user:pass@localhost:5432/mydb');

// ...or from a pg.ClientConfig
const client2 = new PgClient({
  host: 'localhost',
  port: 5432,
  user: 'user',
  password: 'pass',
  database: 'mydb',
});

await client.dumpSchema({ out: './schema/mydb' });
```

Connections are **not** kept open: each `query()` connects, runs, and disconnects. `dumpSchema` is the exception — it opens one connection, runs all collectors in parallel, then closes it.

### Constructor options

```ts
new PgClient(config, {
  logger, // a console-like logger, or `null` to silence all output
  skipSchemas, // extra schemas to skip (pg_catalog & information_schema are always skipped)
  skipFunctions, // function names to skip
});
```

### Restoring a dump

`restoreSchema` reads a dump directory and replays the files into the connected database, ordering them by object kind and promoting referenced functions ahead of the tables that use them.

```ts
const client = new PgClient('postgres://user:pass@localhost/fresh_db');
await client.connect();
await client.restoreSchema({ src: './schema/mydb' });
await client.end();
```

### Database lifecycle helpers

Useful when scripting test databases or restore targets:

```ts
await client.ensureEmptyDb('mydb_test'); // drop if exists, create, switch to it
await client.databaseExists('mydb_test');
await client.createDatabase('mydb_test');
await client.dropDatabase('mydb_test');
await client.switchDatabase('other_db');
await client.truncateTables('mydb_test'); // TRUNCATE ... CASCADE all non-skipped tables
```

## Output structure

Each object kind is written to its own file, prefixed by its type. Foreign keys are emitted as **separate** `fk.*.sql` files so they can be applied after all tables exist. Name collisions are de-duplicated by appending `.v2`, `.v3`, ….

| Prefix       | Object       | Example                             |
| ------------ | ------------ | ----------------------------------- |
| `extension.` | extensions   | `extension.uuid-ossp.sql`           |
| `schema.`    | schemas      | `schema.public.sql`                 |
| `sequence.`  | sequences    | `sequence.public.users_id_seq.sql`  |
| `type.`      | types        | `type.public.mood.sql`              |
| `table.`     | tables       | `table.public.users.sql`            |
| `fk.`        | foreign keys | `fk.public.orders_user_id_fkey.sql` |
| `function.`  | functions    | `function.public.my_func.sql`       |
| `index.`     | indexes      | `index.public.users_email_idx.sql`  |
| `trigger.`   | triggers     | `trigger.public.users_audit.sql`    |
| `view.`      | views        | `view.public.active_users.sql`      |

`CREATE TABLE` statements are reconstructed from collected attributes, with `nextval(...)` defaults mapped back to `serial`/`bigserial`.

## Development

This project uses **pnpm** and requires **Node** (see [.nvmrc](.nvmrc)).

```bash
pnpm install
pnpm build          # rimraf ./dist && tsc
pnpm eslint         # lint ./src
pnpm test:unit      # vitest unit tests (no database required)
pnpm test:coverage  # full suite (unit + e2e) with coverage over ./src
```

### Tests

- **Unit** tests (`tests/unit/`) are pure and need no database.
- **E2E** tests (`tests/e2e/`) use [Testcontainers](https://testcontainers.com/) to spin up an ephemeral PostgreSQL container, so **Docker must be running** locally. In CI, `ubuntu-latest` ships Docker, so no extra setup is needed. To run e2e against an existing database instead of a container, set `TEST_DB_HOST` (and optionally `TEST_DB_PORT` / `TEST_DB_USER` / `TEST_DB_PASSWORD`).

```bash
pnpm test:e2e       # e2e project only (requires Docker)
```

### Git hooks

[lefthook](https://github.com/evilmartians/lefthook) is installed via the `prepare` script and runs:

- **pre-commit** — `eslint --fix` (on `src`) and `prettier --write` on staged files, re-staging fixes.
- **pre-push** — `pnpm build`.

CI runs build, lint, and the full test suite with coverage on every push and pull request to `main`.

### Releases

Releases are automated with [release-please](https://github.com/googleapis/release-please): merging to `main` opens a release PR, and merging that PR bumps the version, writes `CHANGELOG.md`, tags `vX.Y.Z`, creates the GitHub Release and publishes to npm.

Because the version is derived from commit messages, **every commit must be a [Conventional Commit](https://www.conventionalcommits.org/en/v1.0.0/)** — a non-conforming message never triggers a release. Squash is the only merge method and the squash subject is the PR title, so in practice the **PR title** is what matters; a `PR Title` check validates it on every pull request.

See [docs/release-please.md](docs/release-please.md) for the full process, the type-to-bump table, and troubleshooting.
