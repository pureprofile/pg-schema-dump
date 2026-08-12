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
- `pnpm test` — vitest, both projects (`unit` + `e2e`). `prepublishOnly` runs `check` → `build` → `test`.
- `pnpm check` / `pnpm fix` — ultracite (oxlint + oxfmt), config in `oxlint.config.ts` / `oxfmt.config.ts`. `check` reports, `fix` applies.
- `pnpm test:unit` — pure helper tests, no database needed. `pnpm test:e2e` — needs Docker.
- `pnpm test:coverage` — what CI actually runs. [vitest.config.ts](vitest.config.ts) gates coverage at **90%** lines/statements/functions. The gate is on the aggregate across `src` (`perFile: false`, `src/bin.ts` excluded, no branch threshold), so it is a floor against erosion, not a per-change standard — a small untested addition can slip under it on the totals. Run this before pushing; `pnpm test` alone will not tell you.
- Run a single test: `pnpm exec vitest run tests/e2e/dump-db.test.ts` (add `-t "<name>"` to filter).
- `npm start` — build then run the CLI against `dist/bin.js`.

CLI usage: `pg-schema-dump --url postgres://user:pass@host/db --out ./dir`. Without `--out`, output goes to `pg-schema-dump/<NODE_ENV>/<dbName>`.

## Every change lands through a pull request

Work on a branch and merge through a PR. **Never commit directly to `main`.** This is not merely
convention: `main` has no branch protection ([docs/release-please.md](docs/release-please.md) §3),
so a direct push is technically possible — and it is the one path that reaches `main` with the
subject unchecked. The release workflow still runs, so a direct push with a conventional subject
does release normally; the risk is the other case, where a non-conventional subject that the `PR
Title` check would have rejected lands instead, and release-please silently parses nothing from it.

Two existing rules govern a PR here:

- **No tracker reference** in the branch name, PR title, or PR body — anywhere, not even in a
  footer. See [No tracker references](#no-tracker-references).
- **The PR title specifically must be a Conventional Commit**, because squash is the only merge
  method and the title becomes the commit subject verbatim — see
  [Releases](#releases--conventional-commits-are-mandatory). This constrains the title only; branch
  names and PR bodies are free-form (subject to the rule above). Pick the type from what the change
  actually ships: a PR that adds to the public API is a `feat:` even when most of its diff is prose.

### Documentation is part of the change, not a follow-up

Update the documentation a change invalidates **in the same PR**. Two triggers, each of which has
already produced stale docs here:

- **A change to the public API updates the [README](README.md).** `dumpSchema`'s `DumpOmissions`
  return shipped in v2.0.0 undocumented, and the type was not even exported — a whole major version
  where callers could not see or name what the function gave back.
- **A change to the release process or a workflow updates [docs/release-please.md](docs/release-please.md).**
  It is declared the source of truth for that topic, so nothing else contradicts it when it drifts;
  it went a whole release cycle still describing the repo as having never cut an automated one.

Also update this file when a change alters the architecture, the commands, or a convention
described above.

This licence covers hand-written documentation only — `README.md`, `AGENTS.md` and `docs/`. It does
**not** extend to `CHANGELOG.md`, `package.json`'s `version` or `.release-please-manifest.json`,
which release-please owns and which must never be hand-edited (see
[Releases](#releases--conventional-commits-are-mandatory)).

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

`tests/vitest.global-setup.ts` starts **one** `postgres:16-alpine` container for the whole
e2e project and exports its coordinates as those same env vars. The project runs
`pool: 'forks'` with `singleFork: true` and `fileParallelism: false`, so every e2e test
shares that one instance: a new test must create and drop its own database (`ensureEmptyDb`)
rather than assuming an isolated server, and must not leave global state behind. The
container image also bounds what is testable — a feature that needs a newer Postgres needs
that pin raised first.

## Architecture

Flow: **collect** (read catalog) → **write** (emit files) — orchestrated by `PgClient.dumpSchema`.

- `src/index.ts` — the entire public surface: the `PgClient` class and the `DumpOmissions` type it returns. Nothing else is re-exported, so anything a consumer needs to name must be added here deliberately.
- `src/bin.ts` — the CLI entrypoint (`#!/usr/bin/env node`); one of the two ways a scope arrives from outside, the other being the `scope` constructor option a library caller passes. yargs defines `--url` (required), `--out`, `--scope-file` and the repeatable `--include-schema` / `--include-table` / `--include-function`; a manifest read by `loadScopeFile` is combined with those flags by `mergeScope`, the result goes through `validateScope`, and only then is `PgClient` constructed. The `--out` default resolves `current_database()` over a throwaway `pg.Client` first. Excluded from coverage, so logic worth testing belongs in a module it calls rather than here.
- `src/pg-client.ts` — `PgClient`. Holds connection config (parses a URL via `pg-connection-string`, or takes a `pg.ClientConfig`). Key design point: **connections are not kept open** — `query()` does `connect → query → end` each call (see commit `v1.1.0`). `dumpSchema` is the exception: it opens one connection, runs all collectors in a single `Promise.all`, then ends. It returns a `DumpOmissions` (`{ droppedForeignKeys, excludedViews }`) as well as logging it, because `logger: null` is supported and a scope that silently dropped an FK is the costliest failure to find late — a new kind of omission belongs in that return value, not only in a log line. Also provides DB lifecycle helpers used by tests and consumers (`ensureEmptyDb`, `switchDatabase`, `dropDatabase`, `truncateTables`, `restoreSchema`).
- `src/pg-objects/*.ts` — one `collect<Object>(client, opts)` per object kind (extensions, types, functions, indexes, sequences, tables, triggers, views, constraints). Each runs a raw `pg_catalog` query and returns plain rows. `tables.ts` builds each column via nested `jsonb_build_object` in SQL. Constraint and index DDL is **not** hand-assembled — `pg_get_constraintdef` / `pg_get_indexdef` produce it. To add/change what's captured, edit the relevant collector's query.
- `src/pg-objects/scope-sql.ts` — **all shared scope SQL. Nothing here may be restated in a collector.** Two rounds of review found bugs that were exactly a collector hand-rolling its own variant of one of these and getting it subtly wrong, so if a collector needs one of these questions answered, it calls the function:
  - `dependencyOwnerFromSql()` — resolves a `pg_depend` row to the relation whose definition carries the dependency. Each dependent class (`pg_attrdef`, `pg_constraint`, `pg_rewrite`, `pg_trigger`, `pg_index`) keeps its owning relation in a different column, so this is a five-way join that must be identical everywhere. Exposes `dpd`, `dep_owner`, `dep_owner_ns`.
  - `namedByInScopeRelationSql(scope, { refClass, refOid })` — "some relation the dump will contain names this object in its own definition". The general form of the question; **do not** narrow it to one dependent class, which is how a sequence named by a CHECK constraint rather than a column default came to be dropped.
  - `dependencyOwnerInScopeSql(scope)` — the predicate on that resolved owner, including the viable-view branch that breaks the view/function circularity.
  - `viewReadsOnlyInScopeRelationsSql(scope, relOid)` and `DEPENDABLE_RELATION_KINDS` — one definition of "a relation the scope decides", so `views.ts` and the seed cannot disagree about, say, whether a foreign table counts.
  - `inScopeFunctionOidsSql(scope)` — "which functions does this scope reach": the seed above plus the `includeFunctions` escape hatch, then the function-to-function closure. `functions.ts`, `sequences.ts`, `types.ts` and `views.ts` all defer to it.
- `src/scope.ts` / `src/scope-file.ts` — `ScopeOptions` → `ResolvedScope` (SQL predicates; every one self-parenthesizes). `scope-file.ts` loads and **validates** the JSON manifest (`loadScopeFile`), unions a manifest with CLI flags (`mergeScope`), and checks the result (`validateScope`). `validateScope` runs at all three boundaries — manifest, CLI flags, and the `scope` constructor option — so a malformed `schema.table` entry is an error rather than a silently empty dump.
- `src/fs-schema.ts` — `FsSchema`, the file writer, plus `RESTORE_ORDER`. One `write<Object>` method per object kind, each prefixed by the `F_*_PREFIX` constants. `clean()` empties the output dir first. `writeTable` emits **one file per table** carrying its columns, its non-FK constraints, its owned sequences' `OWNED BY`, its indexes and its triggers; `writeForeignKeys` emits that table's FKs separately, since those must wait until every table exists. `outputFileSyncSafe` de-duplicates name collisions by appending `.v2`, `.v3`, ….
- `src/pg-helpers.ts` — SQL/array helpers: `pgQuoteString`/`pgQuoteStrings` (escaping — every user-supplied value must go through these), `pgStringArray`, and `notExtensionOwned` (excludes objects an extension owns, which the extension recreates itself).
- `src/fs-schema-helpers.ts` — SQL normalization for diffability: `normalizedSrc`, `unquoted`, `sortedAttributes` (deterministic column ordering), and `quoteIdent`/`quoteQualified`, which **every** emitted identifier must go through. Hand-quoting is how a mixed-case name silently folds and a name containing a quote character escapes its own identifier.
- `src/utils.ts` — `log` shim over `console`. Pass `logger: null` to `PgClient` to silence output (tests do this).

### Two ordering concerns — keep them distinct

1. **Dump determinism**: collectors `ORDER BY` in SQL and `sortedAttributes` sorts columns, so the same schema always yields byte-identical files (the whole point of the tool). Anything merged into a table file is sorted again at emission, keyed on the SQL text itself. That is belt-and-braces — the collectors already order by name, which is unique per table — so that changing a collector's `ORDER BY` cannot silently reshuffle a committed dump.
2. **Restore dependency order**: `FsSchema.readDir` sorts by the `RESTORE_ORDER` prefix rank — extension → schema → type → sequence → function → table → fk → view. That order is what makes a dump replay in **one pass**, and each step of it is load-bearing:
   - **functions before tables**, applied under `SET check_function_bodies = off`, so a function body may reference a table that does not exist yet;
   - **every table before any foreign key**, so FK cycles between tables restore cleanly;
   - indexes and triggers inline in the table file, which is safe precisely because functions already exist by then.

   `restoreSchema` still requeues a failing file — as many times as the queue comes round, not once; a chain of views can need several — and gives up only once a full cycle makes no progress, reporting **every** unapplied file with its own error. It deliberately does not wrap the restore in a transaction — a failed statement would poison it, which is incompatible with requeueing.

## Conventions

- TypeScript, strict. Lint and format come from [ultracite](https://github.com/haydenbleasel/ultracite) (oxlint + oxfmt), configured in `oxlint.config.ts` / `oxfmt.config.ts`. Don't hand-format — run `pnpm fix`. Hooks are [lefthook](lefthook.yml): `pre-commit` runs `pnpm fix` over staged files and re-stages the fixes, `pre-push` runs `pnpm build`. Note neither hook runs the tests — `prepublishOnly` (`check` → `build` → `test`) is the gate that does.
- `FsSchema` uses `auto-bind` so its `write*` methods can be passed as callbacks (`.then(all(fsSchema.writeTable))`) — keep them as methods.
- Adding a new object kind that gets **its own file** means four coordinated edits: a `collect*` in `src/pg-objects/`, a `write*` + `F_*_PREFIX` in `fs-schema.ts`, that prefix placed in `RESTORE_ORDER`, and a line in `dumpSchema`'s `Promise.all`. A prefix missing from `RESTORE_ORDER` sorts last, which usually still works but only by luck.
- Adding one that belongs **to a table** (like indexes, triggers or non-FK constraints) instead means collecting it, grouping it by `schema.table` in `dumpSchema`, and emitting it from `writeTable` in a sorted order.
- Every collector must honour the scope. A collector that ignores it silently widens a scoped dump back out to the whole database.
- **Dependency vulnerabilities: read [pnpm-workspace.yaml](pnpm-workspace.yaml) before acting on a Dependabot alert.** Its `overrides` block is the carve-out list for transitive vulnerabilities no in-range refresh can reach, and it carries the policy in comments: prefer bumping the parent over adding an entry, every entry must cite its GHSA, and an entry is deleted once the parent ships the fix. An override that forces a version its parent never declared is a standing compatibility risk, so adding one is the last resort, not the first move.
- Commit messages must be Conventional Commits — releases are derived from them. See [Releases](#releases--conventional-commits-are-mandatory) and [docs/release-please.md](docs/release-please.md).
