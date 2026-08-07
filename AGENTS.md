# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## What this is

A CLI + library (`@pureprofile/pg-schema-dump`) that dumps a Postgres schema into many small, individually-named `.sql` files. The goal is a **text-comparable / diffable** representation of a schema (deterministic ordering, normalized SQL) so two databases' schemas can be compared with a plain `diff`/git. It can also restore a dump back into a database.

## Commands

- `npm run build` — `rimraf ./dist && tsc`. The published artifact is `dist/`; `main` is `dist/index.js`, `bin` is `dist/bin.js`.
- `npm test` — full gate: `build` → `eslint` → `jest` (this is also `prepublishOnly`).
- `npm run eslint` — lint `./src` (`--ext=ts,tsx`).
- `npm run jest` — runs jest **and** regenerates the README coverage badges (`jest:badges`).
- `npm run jest:one` — jest **without** the badge regeneration; use this while iterating.
- Run a single test: `npx jest src/__tests__/dump-db.test.ts` (add `-t "<name>"` to filter by test name).
- `npm start` — build then run the CLI against `dist/bin.js`.

CLI usage: `pg-schema-dump --url postgres://user:pass@host/db --out ./dir`. Without `--out`, output goes to `pg-schema-dump/<NODE_ENV>/<dbName>`.

## Releases — Conventional Commits are mandatory

**Every commit message MUST follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)** — `<type>(<scope>): <description>`. This is a hard requirement, not a style preference: [release-please](https://github.com/googleapis/release-please) parses the commit subjects on `main` to decide the next version, so a non-conforming subject is silently dropped from the changelog and never triggers a release.

- Bumps: `fix:`/`perf:` → patch, `feat:` → minor, any `!` or a `BREAKING CHANGE:` footer → major; `chore:`/`docs:`/`test:`/`ci:`/`refactor:`/`style:`/`build:` do not release on their own.
- PRs are squash-merged, so **the PR title is the commit subject** and must be conventional too. The org-wide `PUR-1234: <message>` prefix does **not** work here — use `fix(scope): …` with the ticket in a footer.
- `version` in `package.json`, `CHANGELOG.md` and `.release-please-manifest.json` are owned by release-please — **never hand-edit them**.

Full process — the release PR, tagging, the GitHub Release, and npm OIDC trusted publishing — is documented in [docs/release-please.md](docs/release-please.md).

## Tests require a live Postgres

`src/__tests__/dump-db.test.ts` connects to a **local** Postgres at `host: localhost` (no password) and creates/drops a real `pg-schema-dump-test` database. There is no mock — `npm test`/`jest` will fail without a reachable local Postgres superuser-capable connection. The pure-helper tests (`pg-helpers`, `fs-schema-helpers`) do not need a DB.

## Architecture

Flow: **collect** (read catalog) → **write** (emit files) — orchestrated by `PgClient.dumpSchema`.

- `src/pg-client.ts` — `PgClient`, the single public export (`src/index.ts` re-exports only this). Holds connection config (parses a URL via `pg-connection-string`, or takes a `pg.ClientConfig`). Key design point: **connections are not kept open** — `query()` does `connect → query → end` each call (see commit `v1.1.0`). `dumpSchema` is the exception: it opens one connection, runs all collectors in a single `Promise.all`, then ends. Also provides DB lifecycle helpers used by tests and consumers (`ensureEmptyDb`, `switchDatabase`, `dropDatabase`, `truncateTables`, `restoreSchema`).
- `src/pg-objects/*.ts` — one `collect<Object>(client, opts)` per object kind (extensions, types, functions, indexes, sequences, tables, triggers, views). Each runs a raw `pg_catalog` query and returns plain rows. `tables.ts` is the most complex: it builds each column (including FK `references` and primary-key flags) via nested `jsonb_build_object` in SQL. To add/change what's captured, edit the relevant collector's query.
- `src/fs-schema.ts` — `FsSchema`, the file writer. One `write<Object>` method per object kind, each prefixed by the `F_*_PREFIX` constants (`table.`, `function.`, `fk.`, etc.). `clean()` empties the output dir first. `attributeSql`/`writeTable` reconstruct `CREATE TABLE` from collected attributes, map `nextval(...)` defaults back to `serial`/`bigserial`, and emit foreign keys as **separate** `fk.*.sql` files. `outputFileSyncSafe` de-duplicates name collisions by appending `.v2`, `.v3`, ….
- `src/pg-helpers.ts` — SQL/array helpers (`pgQuoteStrings`, `pgStringArray`) and the **restore-ordering** logic: `sqlGetFunctionReferences` + `findAndShiftFunctionReferences` reorder files during `restoreSchema` so a table's referenced functions are created first.
- `src/fs-schema-helpers.ts` — SQL normalization for diffability: `normalizedSrc`, `unquoted`, `quotedIfUnsafe`, `sortedAttributes` (deterministic column ordering).
- `src/utils.ts` — `log` shim over `console`. Pass `logger: null` to `PgClient` to silence output (tests do this).

### Two ordering concerns — keep them distinct

1. **Dump determinism**: collectors `ORDER BY` in SQL and `sortedAttributes` sorts columns, so the same schema always yields byte-identical files (the whole point of the tool).
2. **Restore dependency order**: `FsSchema.readDir` sorts by object-kind prefix (extension → schema → sequence → type → table → fk), and `findAndShiftFunctionReferences` further promotes referenced functions ahead of the tables that use them. The restore loop also retries a failing file once at the end of the queue before giving up.

## Conventions

- TypeScript, strict. Lint config extends `eslint-config-pureprofile`; Prettier config comes from `eslint-config-pureprofile/prettier-config`. Don't hand-format — run lint/prettier (husky `pre-commit` runs `lint-staged`, `pre-push` runs `npm test`).
- `FsSchema` uses `auto-bind` so its `write*` methods can be passed as callbacks (`.then(all(fsSchema.writeTable))`) — keep them as methods.
- Adding a new object kind means three coordinated edits: a `collect*` in `src/pg-objects/`, a `write*` + `F_*_PREFIX` in `fs-schema.ts`, and a line in `dumpSchema`'s `Promise.all`.
- Commit messages must be Conventional Commits — releases are derived from them. See [Releases](#releases--conventional-commits-are-mandatory) and [docs/release-please.md](docs/release-please.md).
