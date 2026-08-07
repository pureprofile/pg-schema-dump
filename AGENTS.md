# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## What this is

A CLI + library (`@pureprofile/pg-schema-dump`) that dumps a Postgres schema into many small, individually-named `.sql` files. The goal is a **text-comparable / diffable** representation of a schema (deterministic ordering, normalized SQL) so two databases' schemas can be compared with a plain `diff`/git. It can also restore a dump back into a database.

## This repository is public

Nothing here may reference Pureprofile's internal domain. No business table,
column or constraint names, no product or panel vocabulary, no internal rules or
ticket detail — not in code, comments, tests, fixtures, README, commit messages or
pull request descriptions.

Test fixtures use neutral names (`orders`, `customers`, `widget`, `node`, `label`,
`membership`, `billing`, `archive`) precisely for this reason. When a real schema
prompts a fix, describe the _shape_ that broke — "a two-column foreign key
referencing a UNIQUE constraint", "a sequence reached only from a trigger body" —
never the table it was found on.

The `@pureprofile/` npm scope in the package name is the one exception: that is the
published identity.

### No tracker references

**Do not reference Linear, Jira or any other internal tracker** in commit messages,
branch names, pull request titles or pull request bodies — **not even in a footer**. A
`PUR-1234:` prefix is the convention in Pureprofile's private repositories; here it
leaks issue identifiers and tells a reader nothing. Describe the change on its own
terms instead.

Where an internal need drove a change, state the technical shape that required it —
"a scoped dump has to keep a sequence reached only from a trigger body" — not which
project asked or which table it was found on.

Commit message _format_ is a separate, equally hard requirement, and is covered under
[Releases](#releases--conventional-commits-are-mandatory).

## Commands

- `npm run build` — `rimraf ./dist && tsc`. The published artifact is `dist/`; `main` is `dist/index.js`, `bin` is `dist/bin.js`.
- `pnpm test` — vitest, both projects (`unit` + `e2e`). `prepublishOnly` runs `build` → `eslint` → `test`.
- `npm run eslint` — lint `./src` (`--ext=ts,tsx`).
- `pnpm test:unit` — pure helper tests, no database needed. `pnpm test:e2e` — needs Docker.
- Run a single test: `pnpm exec vitest run tests/e2e/dump-db.test.ts` (add `-t "<name>"` to filter).
- `npm start` — build then run the CLI against `dist/bin.js`.

CLI usage: `pg-schema-dump --url postgres://user:pass@host/db --out ./dir`. Without `--out`, output goes to `pg-schema-dump/<NODE_ENV>/<dbName>`.

## Releases — Conventional Commits are mandatory

**Every commit message MUST follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)** — `<type>(<scope>): <description>`. This is a hard requirement, not a style preference: [release-please](https://github.com/googleapis/release-please) parses the commit subjects on `main` to decide the next version, so a non-conforming subject is silently dropped from the changelog and never triggers a release.

- Bumps: `fix:`/`perf:`/`revert:` → patch, `feat:` → minor, any `!` or a `BREAKING CHANGE:` footer → major; `chore:`/`docs:`/`test:`/`ci:`/`refactor:`/`style:`/`build:` do not release on their own. (`revert:` is **not** a quiet type — a revert-only merge cuts a patch release.)
- Squash is the only merge method and the squash subject is the PR title, so **the PR title _is_ the commit subject** and must be conventional too. The `PR Title` check ([`.github/workflows/pr-title.yml`](.github/workflows/pr-title.yml)) enforces this and re-runs when you edit the title. The org-wide `PUR-1234: <message>` prefix does **not** work here — use `fix(scope): …`, and put the ticket **nowhere at all**, not even in a footer (see [No tracker references](#no-tracker-references)).
- `version` in `package.json`, `CHANGELOG.md` and `.release-please-manifest.json` are owned by release-please — **never hand-edit them**.

Full process — the release PR, tagging, the GitHub Release, and npm OIDC trusted publishing — is documented in [docs/release-please.md](docs/release-please.md).

## Tests require Postgres

The `e2e` project (`tests/e2e/`) starts an ephemeral Postgres via Testcontainers, so
**Docker must be running**. Set `TEST_DB_HOST` (and optionally `TEST_DB_PORT` /
`TEST_DB_USER` / `TEST_DB_PASSWORD`) to run against an existing instance instead.
The unit tests (`tests/unit/`) are pure and need no database.

## Architecture

Flow: **collect** (read catalog) → **write** (emit files) — orchestrated by `PgClient.dumpSchema`.

- `src/pg-client.ts` — `PgClient`, the single public export (`src/index.ts` re-exports only this). Holds connection config (parses a URL via `pg-connection-string`, or takes a `pg.ClientConfig`). Key design point: **connections are not kept open** — `query()` does `connect → query → end` each call (see commit `v1.1.0`). `dumpSchema` is the exception: it opens one connection, runs all collectors in a single `Promise.all`, then ends. Also provides DB lifecycle helpers used by tests and consumers (`ensureEmptyDb`, `switchDatabase`, `dropDatabase`, `truncateTables`, `restoreSchema`).
- `src/pg-objects/*.ts` — one `collect<Object>(client, opts)` per object kind (extensions, types, functions, indexes, sequences, tables, triggers, views, constraints). Each runs a raw `pg_catalog` query and returns plain rows. `tables.ts` builds each column via nested `jsonb_build_object` in SQL. Constraint and index DDL is **not** hand-assembled — `pg_get_constraintdef` / `pg_get_indexdef` produce it. To add/change what's captured, edit the relevant collector's query.
- `src/pg-objects/scope-sql.ts` — `inScopeFunctionOidsSql`, the single source of truth for "which functions does this scope reach". A recursive CTE: functions named by an in-scope table's defaults, constraints, rewrite rules, triggers or indexes, plus the `includeFunctions` escape hatch, then the function-to-function closure. `functions.ts`, `sequences.ts` and `views.ts` all defer to it — do not re-derive the set locally.
- `src/scope.ts` / `src/scope-file.ts` — `ScopeOptions` → `ResolvedScope` (SQL predicates; every one self-parenthesizes). `scope-file.ts` loads and **validates** the JSON manifest, and `validateScope` is applied to CLI flags too, so a malformed `schema.table` entry is an error rather than a silently empty dump.
- `src/fs-schema.ts` — `FsSchema`, the file writer, plus `RESTORE_ORDER`. One `write<Object>` method per object kind, each prefixed by the `F_*_PREFIX` constants. `clean()` empties the output dir first. `writeTable` emits **one file per table** carrying its columns, its non-FK constraints, its owned sequences' `OWNED BY`, its indexes and its triggers; `writeForeignKeys` emits that table's FKs separately, since those must wait until every table exists. `outputFileSyncSafe` de-duplicates name collisions by appending `.v2`, `.v3`, ….
- `src/pg-helpers.ts` — SQL/array helpers: `pgQuoteString`/`pgQuoteStrings` (escaping — every user-supplied value must go through these), `pgStringArray`, and `notExtensionOwned` (excludes objects an extension owns, which the extension recreates itself).
- `src/fs-schema-helpers.ts` — SQL normalization for diffability: `normalizedSrc`, `unquoted`, `quotedIfUnsafe`, `sortedAttributes` (deterministic column ordering), and `quoteIdent`/`quoteQualified` for identifier emission.
- `src/utils.ts` — `log` shim over `console`. Pass `logger: null` to `PgClient` to silence output (tests do this).

### Two ordering concerns — keep them distinct

1. **Dump determinism**: collectors `ORDER BY` in SQL and `sortedAttributes` sorts columns, so the same schema always yields byte-identical files (the whole point of the tool). Anything merged into a table file is sorted again at emission, because a collector's order is only guaranteed _across_ tables, not within one.
2. **Restore dependency order**: `FsSchema.readDir` sorts by the `RESTORE_ORDER` prefix rank — extension → schema → type → sequence → function → table → fk → view. That order is what makes a dump replay in **one pass**, and each step of it is load-bearing:

   - **functions before tables**, applied under `SET check_function_bodies = off`, so a function body may reference a table that does not exist yet;
   - **every table before any foreign key**, so FK cycles between tables restore cleanly;
   - indexes and triggers inline in the table file, which is safe precisely because functions already exist by then.

   `restoreSchema` still requeues a failing file (chained views can need a second pass) and gives up once a full cycle makes no progress, reporting **every** unapplied file with its own error. It deliberately does not wrap the restore in a transaction — a failed statement would poison it, which is incompatible with requeueing.

## Conventions

- TypeScript, strict. Lint config extends `eslint-config-pureprofile`; Prettier config comes from `eslint-config-pureprofile/prettier-config`. Don't hand-format — run lint/prettier. Hooks are [lefthook](lefthook.yml): `pre-commit` runs eslint `--fix` + prettier over staged files and re-stages them, `pre-push` runs `pnpm build`. Note neither hook runs the tests — `prepublishOnly` (`build` → `eslint` → `test`) is the gate that does.
- `FsSchema` uses `auto-bind` so its `write*` methods can be passed as callbacks (`.then(all(fsSchema.writeTable))`) — keep them as methods.
- Adding a new object kind that gets **its own file** means four coordinated edits: a `collect*` in `src/pg-objects/`, a `write*` + `F_*_PREFIX` in `fs-schema.ts`, that prefix placed in `RESTORE_ORDER`, and a line in `dumpSchema`'s `Promise.all`. A prefix missing from `RESTORE_ORDER` sorts last, which usually still works but only by luck.
- Adding one that belongs **to a table** (like indexes, triggers or non-FK constraints) instead means collecting it, grouping it by `schema.table` in `dumpSchema`, and emitting it from `writeTable` in a sorted order.
- Every collector must honour the scope. A collector that ignores it silently widens a scoped dump back out to the whole database.
- Commit messages must be Conventional Commits — releases are derived from them. See [Releases](#releases--conventional-commits-are-mandatory) and [docs/release-please.md](docs/release-please.md).
