# Releases (release-please)

Versioning, changelog, tagging, the GitHub Release and the npm publish of
`@pureprofile/pg-schema-dump` are fully automated by
[release-please](https://github.com/googleapis/release-please). Nobody bumps a
version or runs `npm publish` by hand.

This document is the source of truth for how that works. [AGENTS.md](../AGENTS.md)
and the [README](../README.md) only summarise it.

## 1. TL;DR

- Write every commit message as a [Conventional Commit](https://www.conventionalcommits.org/en/v1.0.0/) — `fix(fs-schema): …`, `feat: …`, `chore: …`.
- Merge your PR to `main` (squash-merge, so the **PR title** becomes the commit subject).
- release-please opens — or updates — a single PR titled `chore(main): release X.Y.Z`.
- Merging **that** PR bumps the version, writes `CHANGELOG.md`, tags `vX.Y.Z`, creates the GitHub Release, and publishes to npm.
- Never hand-edit `package.json`'s `version`, `CHANGELOG.md`, or `.release-please-manifest.json`.

If your commit subject is not a Conventional Commit, it is silently dropped from
the changelog and never triggers a release — the code lands on `main` and then
sits there unreleased. That is the one failure mode to internalise.

## 2. Why this exists

Releases up to `v1.1.0` were a manual ritual: hand-edit `version` in
`package.json`, commit it as `v1.1.0: rewrite to not keep open connections`, push
a tag by hand, then run `npm publish` from a laptop. The results show the cost —
there is no `CHANGELOG.md` in the repo's history, and none of `v1.0.0` … `v1.1.0`
has a GitHub Release, so there is no published record of what changed in any
version.

release-please replaces all of that with one input (the commit message) and one
decision point (merging the release PR).

## 3. Commit messages are the input — and are mandatory

Every commit that lands on `main` **must** follow the Conventional Commits 1.0.0
spec: <https://www.conventionalcommits.org/en/v1.0.0/>.

```
<type>[optional scope][!]: <description>

[optional body]

[optional footers]
```

- `<type>` — lowercase, from the list in the table below.
- `[scope]` — optional, in parentheses; use the module it touches (`fs-schema`, `pg-client`, `pg-objects`, `deps`, …).
- `!` — marks a breaking change (equivalent to a `BREAKING CHANGE:` footer).
- `<description>` — imperative, lowercase, no trailing period.
- Footers that matter here: `BREAKING CHANGE: <what broke>`, `Release-As: X.Y.Z`, and free-form ones like `Refs: PUR-1234`.

This is a hard requirement, not a style preference. release-please parses the
commit subjects on `main` to decide the next version; a subject it cannot parse
contributes nothing — no changelog entry, no version bump.

### Which type bumps which number

| Commit type                                                                | Version bump   | In the changelog?      |
| -------------------------------------------------------------------------- | -------------- | ---------------------- |
| `fix:`                                                                     | patch          | yes — _Bug Fixes_      |
| `perf:`                                                                    | patch          | yes — _Performance_    |
| `feat:`                                                                    | minor          | yes — _Features_       |
| any `!` (e.g. `feat!:`, `fix(pg-client)!:`) or a `BREAKING CHANGE:` footer | **major**      | yes — _⚠ BREAKING_     |
| `chore:` `docs:` `test:` `ci:` `refactor:` `style:` `build:` `revert:`     | none by itself | no (hidden by default) |

The non-releasing types are not wasted work: once _something_ triggers a release,
they are part of the released commit range — they just cannot open a release PR on
their own. Note that this package is past `1.0.0`, so a breaking change really
does bump the major (on a `0.x` version, release-please would bump the minor
instead).

### Worked examples

Good — a patch release:

```
fix(fs-schema): escape column names in generated fk sql
```

Good — a breaking release, with the reason in a footer:

```
feat!: scope dumps to the resolved dependency closure

BREAKING CHANGE: dumpSchema now emits only objects reachable from the
requested schemas, so previously-included unrelated objects are omitted.
```

Good — a change that ships but does not release on its own:

```
chore(deps): force patched transitive versions via overrides
```

Rejected — parsed as nothing, released as nothing:

```
updated stuff              # no type prefix
Fix bug                    # not a type; `fix:` (lowercase, with colon) is required
PUR-4706: fix fk ordering  # ticket prefix is not a Conventional Commit type
```

That last one matters: the wider Pureprofile convention of prefixing commits with
a Linear ticket (`PUR-4706: …`) does **not** work in this repo. Put the
conventional type first and the ticket in the body or a footer:

```
fix(pg-helpers): promote referenced functions ahead of tables on restore

Refs: PUR-4706
```

### Squash-merge, so the PR title is the commit message

PRs here are squash-merged, which means **the PR title becomes the commit subject
on `main`** — so the PR title must be a valid Conventional Commit. Individual
commits inside a PR are not what release-please reads.

## 4. The pipeline, step by step

Everything below is driven by [`.github/workflows/release-please.yml`](../.github/workflows/release-please.yml),
which runs on every push to `main` (and can be triggered manually via
`workflow_dispatch`).

1. **You merge a PR to `main`.** The workflow starts. `concurrency: release_please`
   ensures only one run at a time.
2. **release-please reads its config** — [`release-please-config.json`](../release-please-config.json)
   and [`.release-please-manifest.json`](../.release-please-manifest.json) — from
   the `main` branch, and scans the commits back to the last release
   (`last-release-sha`, then subsequent release tags it created itself).
3. **It computes the next version** from the commit types it found, per the table
   above.
4. **It opens or updates the release PR**, titled `chore(main): release X.Y.Z`.
   There is only ever **one** open release PR — subsequent merges to `main` update
   it in place, accumulating entries and re-computing the version. It is not one PR
   per commit. If no releasable commit exists yet, no PR appears at all.
5. **That PR's diff is machine-written and small**: the `version` field in
   `package.json`, a new section at the top of `CHANGELOG.md`, and the version in
   `.release-please-manifest.json`. Read it to confirm the version and changelog
   look right; don't edit it (see §6).
6. **You merge the release PR.** The workflow runs again on that push, and this
   time release-please sets `release_created`, creates the `vX.Y.Z` git tag, and
   publishes a GitHub Release whose body is the changelog section.
7. **Only then do the publish steps run** (they are all guarded by
   `if: steps.release.outputs.release_created`): checkout, pnpm + Node from
   [`.nvmrc`](../.nvmrc), `pnpm install --frozen-lockfile`, then `npm publish`.
8. **`npm publish` runs `prepublishOnly`** — `build` → `eslint` → `test` — and
   uploads the tarball to npm with a provenance attestation.

## 5. What each file does

**[`.github/workflows/release-please.yml`](../.github/workflows/release-please.yml)** —
the whole pipeline. One job, two halves: the `googleapis/release-please-action@v5`
step (always runs; manages the release PR, tag and GitHub Release), and the publish
steps (guarded by `release_created`, so they only fire on the run that merged a
release PR). Its `permissions` block is what makes both halves possible:
`contents: write` for the tag and Release, `pull-requests: write` for the release
PR, `id-token: write` for the npm OIDC exchange. Deps are installed with pnpm (the
repo's package manager, and the only lockfile) but the publish itself uses
`npm publish`, because trusted publishing is implemented by the npm CLI.

**[`release-please-config.json`](../release-please-config.json)** — declares one
package at the repo root with `release-type: node`, which is what teaches
release-please to bump `package.json` and write `CHANGELOG.md`. `last-release-sha`
is pinned to `33832d8e56c042f8bc08b3ee9d3355a59e7eaf33`, the commit tagged
`v1.1.0`: it stops the commit scan there so the first changelog covers only
post-`v1.1.0` work instead of reaching back over the entire history.

**[`.release-please-manifest.json`](../.release-please-manifest.json)** — the
recorded current version, `1.1.0`, matching `package.json`. Its presence is what
puts release-please in **manifest mode**, and that is deliberate: in the simpler
`release-type` input mode, release-please discovers the last version from GitHub
_Releases_, and this repo's pre-automation tags have none — so it could
mis-derive the starting version. The manifest makes it explicit and deterministic.
release-please rewrites this file in each release PR.

**`CHANGELOG.md`** (generated on the first release) — grouped by the changelog
sections in the table above, newest version first, with links to each commit and
PR. It is a build artifact of the commit history, not a document anyone writes.

## 6. Files release-please owns — never hand-edit

- `version` in `package.json`
- `CHANGELOG.md`
- `.release-please-manifest.json`
- the `vX.Y.Z` git tags and their GitHub Releases

Hand-editing any of these desynchronises release-please's view of the current
version from the repo's. The symptoms are a release PR that proposes a version you
did not expect (usually re-proposing one you already "released" manually), or a
changelog with a duplicate or missing section. If it happens, fix it by setting
`.release-please-manifest.json` back to the version actually published on npm and
letting the next run recompute — not by editing `package.json`.

The same goes for the release PR itself: don't push changes onto it. If the
proposed version is wrong, close it, land a corrective commit on `main` (a
`Release-As:` footer if you need a specific version), and let release-please open
a fresh one.

## 7. Publishing and permissions

Publishing uses **npm [trusted publishing](https://docs.npmjs.com/trusted-publishers)**
(OIDC). Practical consequences:

- **There is no npm token in this repo** — no `NPM_TOKEN` secret, no
  `NODE_AUTH_TOKEN` in the workflow, nothing to rotate or leak. The
  `id-token: write` permission lets the runner mint a short-lived OIDC token that
  npm exchanges for publish rights.
- **Provenance is automatic.** Publishing this way attaches a signed provenance
  attestation linking the tarball to this repo, this workflow and the exact commit;
  npm shows it as a provenance badge on the package page.
- **It requires a one-time Trusted Publisher entry on npmjs.com** for
  `@pureprofile/pg-schema-dump` (Settings → Publishing access → GitHub Actions):
  organisation `pureprofile`, repository `pg-schema-dump`, workflow filename
  `release-please.yml`, environment left blank. The workflow filename is part of
  the trust relationship — **renaming or moving the workflow file breaks
  publishing** until the npm entry is updated to match.
- **It requires npm CLI ≥ 11.5.1 and Node ≥ 22.14** on the runner. Node comes from
  [`.nvmrc`](../.nvmrc) (24), whose bundled npm satisfies this; see §10 if that ever
  regresses.

`prepublishOnly` (`build` → `eslint` → `test`, including the Testcontainers e2e
suite, which needs Docker — `ubuntu-latest` has it) runs inside `npm publish` and
is the last gate before the tarball is uploaded.

One ordering consequence worth knowing: the tag and GitHub Release are created
**before** `npm publish` runs. If the publish fails — red test, npm outage,
misconfigured trusted publisher — the tag and Release exist but npm has no such
version. Do not delete or move the tag. Fix forward: land a commit on `main` and
let the next release go out under a new version number.

## 8. How to force a release

- **Release work made only of non-releasing types** (a docs- or chore-only batch
  you nevertheless want published): add a `Release-As:` footer to a commit on
  `main`.

  ```
  chore: refresh dependency overrides

  Release-As: 1.1.1
  ```

  This also works for jumping to a specific version deliberately (e.g. a
  pre-planned `2.0.0`).

- **Re-run the workflow without a new commit** — Actions → _Release Please_ → _Run
  workflow_ (`workflow_dispatch`). Use this when a run failed for infrastructure
  reasons.

- **Re-run only the publish** — re-running the workflow on the release-PR merge
  commit is the supported route: release-please recognises the release already
  exists, still reports `release_created`, and the publish steps run again. `npm
publish` will refuse to overwrite a version that did make it to npm, which is the
  safe outcome.

## 9. Known behaviours and gotchas

- **`ci.yml` does not run on release PRs.** release-please uses the default
  `GITHUB_TOKEN`, and PRs opened by that token deliberately do not trigger
  `pull_request` workflows. The release PR contains only machine-generated version
  and changelog edits, and the code in it already passed CI on the push to `main`;
  `prepublishOnly` re-runs build, lint and tests before the tarball is uploaded.
  Wiring a PAT secret is the only way to change this, and would trade a token to
  manage for a duplicate CI run.
- **Only one release run at a time.** `concurrency: release_please` (no
  `cancel-in-progress`) serialises runs so two pushes cannot race on the tag or the
  release PR.
- **The first release PR is not immediate.** The commits already on `main` after
  `v1.1.0` are all `chore`/`test`/`docs`, so nothing releasable exists yet. The
  first release PR appears when a `fix:`/`feat:`/breaking commit lands — or
  immediately, if you use a `Release-As:` footer per §8.

## 10. Troubleshooting

| Symptom                                                        | Likely cause                                                                                                         | Fix                                                                                                                  |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Merged to `main`, no release PR appeared                       | Commit subjects are not Conventional Commits, or they are all non-releasing types (`chore`/`docs`/`test`/`ci`)       | Check the workflow run log — it lists the commits it parsed. Land a `fix:`/`feat:` commit, or use `Release-As:` (§8) |
| Release PR proposes an unexpected version                      | `.release-please-manifest.json` is out of sync with what is on npm, or `last-release-sha` points at the wrong commit | Set the manifest to the version actually published, close the release PR, let the next run recompute                 |
| Your change is missing from `CHANGELOG.md`                     | Its subject was unparseable, or its type is hidden by default                                                        | Nothing to fix retroactively; use a correct type next time (`revert:`/`chore:` are intentionally hidden)             |
| `npm publish` fails with `ENEEDAUTH` / OIDC or 403 errors      | No Trusted Publisher on npmjs.com, or its org/repo/**workflow filename** doesn't match this workflow                 | Recreate the entry per §7. If the workflow file was renamed, update the npm entry to the new filename                |
| `npm publish` fails saying trusted publishing is not supported | npm CLI on the runner is older than 11.5.1                                                                           | Add `- run: npm install -g npm@latest` (same `if:` guard) immediately before the `npm publish` step                  |
| Publish failed on tests, but the tag and Release exist         | Expected ordering (§7)                                                                                               | Do not re-tag. Fix forward with a new commit on `main` and let the next version publish                              |
| No release PR **and** the log shows a permissions error        | Repo/org setting "Allow GitHub Actions to create and approve pull requests" is off                                   | Enable it in Settings → Actions → General → Workflow permissions                                                     |
| Publish succeeded but npm shows no provenance                  | Published from something other than this OIDC workflow (e.g. a laptop)                                               | Always release through the workflow; `npm publish` from a laptop is no longer part of the process                    |

## 11. Reference

- Conventional Commits 1.0.0 — <https://www.conventionalcommits.org/en/v1.0.0/>
- release-please — <https://github.com/googleapis/release-please>
- release-please configuration reference — <https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md>
- `googleapis/release-please-action` — <https://github.com/googleapis/release-please-action>
- npm trusted publishing — <https://docs.npmjs.com/trusted-publishers>
