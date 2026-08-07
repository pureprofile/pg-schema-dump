# pg-schema-dump

`@pureprofile/pg-schema-dump` dumps a PostgreSQL schema into many small, individually-named `.sql` files so a schema becomes **text-comparable and diffable**.

Instead of one monolithic dump, each object is written to a file with a deterministic name and normalized SQL. Two databases can then be compared with a plain `diff` or committed to git to track schema drift over time. A dump can also be **restored** into an empty database, which makes a committed dump usable as a test fixture.

Objects that belong to a single table — its indexes, triggers, primary key, unique and check constraints, and ownership of its sequences — are written **into that table's file**, because none of them can be referenced from elsewhere. Foreign keys get one file per table, since they must wait until every table exists.

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
pg-schema-dump --url <connection-string> [--out <dir>] [scope options]
```

| Option               | Required | Description                                                       |
| -------------------- | -------- | ----------------------------------------------------------------- |
| `--url`              | yes      | PostgreSQL connection string to the database to dump.             |
| `--out`              | no       | Directory to write the dump into. See default below.              |
| `--scope-file`       | no       | Path to a JSON manifest listing what to include. See **Scoping**. |
| `--include-schema`   | no       | Include a whole schema. Repeatable.                               |
| `--include-table`    | no       | Include one `schema.table`. Repeatable.                           |
| `--include-function` | no       | Include one `schema.function` explicitly. Repeatable.             |

When `--out` is omitted, output goes to `pg-schema-dump/<NODE_ENV>/<dbName>` (where `NODE_ENV` defaults to `development` and `dbName` is read from the connection).

With no scope options the whole database is dumped, exactly as before.

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

## Scoping

Dumping a whole legacy database can produce thousands of files, most of them irrelevant. A scope narrows the dump to the tables you actually care about. The intended workflow is a **committed manifest** you edit deliberately:

```json
{
  "schemas": ["billing", "archive"],
  "tables": ["public.orders", "public.customers"],
  "functions": []
}
```

```bash
pg-schema-dump --url "$DB_URL" --out ./db/schema --scope-file ./db/table-scope.json
```

The scope is a list, not a starting point — it is **not** expanded by following foreign keys, so the dump stays reproducible as the source database changes. Work out the closure you need once (a recursive query over `pg_constraint.confrelid` does it), commit the result, and widen it when something new needs a table.

What a scope pulls in alongside the tables you named:

- **Sequences** owned by an in-scope table, called by one of its column defaults, or named by `nextval()` inside the body of an in-scope function. That third path is not optional: a sequence reached only from a trigger body is invisible to the catalog's dependency graph, and omitting it fails the first insert that fires the trigger rather than failing the restore.
- **Functions** reachable from in-scope tables — column defaults, CHECK constraints, expression indexes, trigger and rewrite-rule bodies — and then, recursively, the functions those functions call. Plus anything in `functions`. Not every function in the schema, which on a large database is the difference between a hundred files and several hundred.
- **Indexes, triggers and constraints** of in-scope tables.
- **Views** only when everything they read is in scope — relations _and_ functions, since a view calling a missing function fails to create just as surely as one reading a missing table. A view is judged purely by its dependencies, so a view living in a schema you never named is still dumped if everything it reads is in scope.
- **Schemas** for everything included, so a restore has somewhere to put it.

A foreign key whose target table is out of scope is **omitted rather than emitted**, because a key pointing at a table the dump does not contain cannot be restored. Every omission is logged:

```
scope: dropped FK public.orders.pricing_rule_id -> pricing.rule (target out of scope)
scope: excluded view public.order_summary (depends on out-of-scope public.shipment)
```

Read that log when you widen a scope — it tells you what you are still missing.

Objects owned by an extension are always excluded, since `CREATE EXTENSION` recreates them.

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
  skipExtensions, // extension names to skip, e.g. one unavailable in your target image
  scope, // { includeSchemas, includeTables, includeFunctions } — see Scoping
});
```

### Restoring a dump

`restoreSchema` reads a dump directory and replays it into the connected database.

```ts
const client = new PgClient('postgres://user:pass@localhost/fresh_db');
await client.connect();
await client.restoreSchema({ src: './schema/mydb' });
await client.end();
```

Files are applied in an order where every dependency is satisfied by an earlier file, so a dump replays in a single pass:

| Order | Prefix       | Notes                                                          |
| ----- | ------------ | -------------------------------------------------------------- |
| 1     | `extension.` |                                                                |
| 2     | `schema.`    |                                                                |
| 3     | `type.`      |                                                                |
| 4     | `sequence.`  | so a table's `default nextval(...)` resolves                   |
| 5     | `function.`  | applied with `check_function_bodies` off                       |
| 6     | `table.`     | columns, constraints, sequence ownership, indexes and triggers |
| 7     | `fk.`        | after every table exists                                       |
| 8     | `view.`      | may reference any table or function                            |

Two consequences worth knowing:

- **Functions are restored before tables**, under `check_function_bodies = off`, so a function body may reference a table that does not exist yet. This is what makes it safe to merge triggers and expression indexes into table files.
- **Every table is created before any foreign key is added**, so foreign key _cycles_ between tables restore without special handling.

A file that fails is requeued once behind the others — enough for chained views — and the restore gives up when a full cycle passes with nothing succeeding. The error then names **every** file left unapplied with its own cause:

```
restoreSchema: 2 file(s) could not be applied:
  - table.public.thing.sql: relation "some_seq" does not exist
  - view.public.other.sql: column reference "x" is ambiguous
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

Name collisions are de-duplicated by appending `.v2`, `.v3`, ….

| Prefix       | Object                    | Example                            |
| ------------ | ------------------------- | ---------------------------------- |
| `extension.` | extensions                | `extension.uuid-ossp.sql`          |
| `schema.`    | schemas                   | `schema.public.sql`                |
| `type.`      | enum types                | `type.public.mood.sql`             |
| `sequence.`  | sequences                 | `sequence.public.users_id_seq.sql` |
| `function.`  | functions                 | `function.public.my_func.sql`      |
| `table.`     | a table and its own parts | `table.public.users.sql`           |
| `fk.`        | one table's foreign keys  | `fk.public.orders.sql`             |
| `view.`      | views                     | `view.public.active_users.sql`     |

A `table.*.sql` file holds the `CREATE TABLE` — columns plus named primary key, unique, check and exclusion constraints — followed by `ALTER SEQUENCE ... OWNED BY` for any sequence it owns, then its indexes, then its triggers. It replays as one multi-statement script.

Constraint definitions come from `pg_get_constraintdef`, so composite primary keys, multi-column foreign keys and check constraints are all reproduced exactly.

`nextval(...)` column defaults are emitted verbatim rather than collapsed to `serial`/`bigserial`. The shorthand made Postgres auto-create a second sequence that collided with the dumped one, and it only ever matched tables in the search path, since sequence names are schema-qualified elsewhere.

### Known gaps

Not currently collected: materialized views, partitioned tables (`relkind = 'p'`), `GENERATED ... AS IDENTITY` columns, domain/composite/range types (only enums), and row data — a dump is schema-only, so fixtures need their own seed script.

One restore-order shape is not solvable by the bucket rank, and will fail rather than silently misbehave: a function whose **signature** takes a table's composite row type (`CREATE FUNCTION f(public.t)`), where that same table also carries a CHECK constraint or expression index calling `f`. Functions restore first, and `check_function_bodies = off` relaxes body validation only — the signature still needs the row type, so `f` cannot be created before `t`. But `t`'s file carries the dependent index, which cannot be created before `f`, and a table file is a single multi-statement query that rolls back whole. Neither can go first. Breaking it means splitting the dependent objects out of the table file, which trades away the file-count reduction that merging exists for, so it stays unsolved until a real schema needs it. The restore stops and names both files.

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
