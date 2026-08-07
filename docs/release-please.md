# Releases (release-please)

Versioning, changelog, tagging, the GitHub Release and the npm publish of
`@pureprofile/pg-schema-dump` are fully automated by
[release-please](https://github.com/googleapis/release-please). Nobody bumps a
version or runs `npm publish` by hand.

This document is the source of truth for how that works. [AGENTS.md](../AGENTS.md)
and the [README](../README.md) only summarise it.

## 1. TL;DR

- Write every commit message as a [Conventional Commit](https://www.conventionalcommits.org/en/v1.0.0/) — `fix(fs-schema): …`, `feat: …`, `chore: …`.
- Merge your PR to `main` — squash is the only option, and the PR title becomes the commit subject (a check enforces that it is conventional).
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
- Footers that matter here: `BREAKING CHANGE: <what broke>` and `Release-As: X.Y.Z`. Do **not** add an issue-tracker footer — see [No tracker references](../AGENTS.md#no-tracker-references).

This is a hard requirement, not a style preference. release-please parses the
commit subjects on `main` to decide the next version; a subject it cannot parse
contributes nothing — no changelog entry, no version bump.

### Which type bumps which number

| Commit type                                                                | Version bump   | In the changelog?      |
| -------------------------------------------------------------------------- | -------------- | ---------------------- |
| `fix:`                                                                     | patch          | yes — _Bug Fixes_      |
| `perf:`                                                                    | patch          | yes — _Performance_    |
| `revert:`                                                                  | patch          | yes — _Reverts_        |
| `feat:`                                                                    | minor          | yes — _Features_       |
| any `!` (e.g. `feat!:`, `fix(pg-client)!:`) or a `BREAKING CHANGE:` footer | **major**      | yes — _⚠ BREAKING_     |
| `chore:` `docs:` `test:` `ci:` `refactor:` `style:` `build:`               | none by itself | no (hidden by default) |

`revert:` is easy to get wrong: it is **not** one of the quiet types — a
revert-only merge opens a patch release PR on its own, which is usually what you
want (the revert should ship).

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
updated stuff             # no type prefix
Fix bug                   # not a type; `fix:` (lowercase, with colon) is required
ABC-123: fix fk ordering  # a ticket prefix is not a Conventional Commit type
```

That last one matters twice over. The wider Pureprofile convention of prefixing a
commit with an issue-tracker id does **not** work in this repo — and because this
repository is **public**, the id must not be relocated into the body or a footer
either. Drop it entirely and describe the change on its own terms:

```
fix(pg-client): report every unapplied file when a restore stalls
```

See [No tracker references](../AGENTS.md#no-tracker-references) for the full rule.

### The PR title is the commit subject, and it is checked

**Squash is the only merge method enabled on this repo**, and the squash subject is
configured as `PR_TITLE`. So the PR title becomes the commit subject on `main`
verbatim — including for single-commit PRs, where GitHub would otherwise pre-fill
the commit's own message. Individual commits inside a PR are never what
release-please reads; only the squashed subject is.

That title is enforced by the **PR Title** check
([`.github/workflows/pr-title.yml`](../.github/workflows/pr-title.yml)), which
rejects a PR whose title is not a Conventional Commit with one of the types in the
table above. It re-runs when you edit the title, so a red check goes green as soon
as you fix it — no new commit needed.

One gap remains, deliberately: `main` has **no branch protection**, so the check is
advisory rather than blocking, and someone with push access can still commit
straight to `main` and bypass PRs entirely. Making the check a hard gate means
enabling branch protection with `PR Title` as a required status check.

## 4. The pipeline, step by step

Everything below is driven by [`.github/workflows/release-please.yml`](../.github/workflows/release-please.yml),
which runs on every push to `main` (and can be triggered manually via
`workflow_dispatch`, though its jobs refuse to run on any ref but `main`).

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
   look right; don't edit it (see [Files release-please owns](#6-files-release-please-owns--never-hand-edit)).
6. **You merge the release PR.** The workflow runs again on that push, and this
   time release-please sets `release_created`, creates the `vX.Y.Z` git tag, and
   publishes a GitHub Release whose body is the changelog section.
7. **Only then does the `publish` job run**, gated on that `release_created`
   output. It checks out **the commit release-please tagged** (the job's `sha`
   output, not the ref that triggered the run), sets up pnpm and Node from
   [`.nvmrc`](../.nvmrc), runs `pnpm install --frozen-lockfile`, then
   `npm publish`.
8. **`npm publish` runs the `prepublishOnly` gate** and uploads the tarball to npm
   with a provenance attestation — see
   [Publishing and permissions](#7-publishing-and-permissions).

## 5. What each file does

**[`.github/workflows/release-please.yml`](../.github/workflows/release-please.yml)** —
the whole pipeline, as **two jobs** so that each holds only the permissions it
needs:

- `release-please` runs `googleapis/release-please-action@v5` on every push to
  `main` and owns the release PR, the tag and the GitHub Release. It holds
  `contents: write` and `pull-requests: write`, and **no** `id-token` — it cannot
  publish.
- `publish` runs only when the first job reports `release_created`, and holds
  `contents: read` plus `id-token: write` (the npm OIDC exchange). It builds from
  the tagged commit, so the tarball can never contain a later commit's source.

Both jobs are guarded by `if: github.ref == 'refs/heads/main'`, so a
`workflow_dispatch` run on another branch cannot tag, release or publish under
this workflow's npm identity. Deps install with pnpm (the repo's package manager
and only lockfile) but the publish itself uses `npm publish`, because trusted
publishing is implemented by the npm CLI. `actions/setup-node` must stay at **v7
or newer**: v6 exports a dummy `NODE_AUTH_TOKEN` whenever `registry-url` is set,
which breaks the OIDC exchange.

**[`.github/workflows/pr-title.yml`](../.github/workflows/pr-title.yml)** — the
guard on the pipeline's only input. Because squash is the sole merge method and the
squash subject is the PR title, an unconventional PR title would land on `main` as
an unparseable commit subject and quietly go unreleased. This check validates the
title against the same type list as the table above, and re-runs on title edits.
The type list is duplicated here on purpose — a workflow input is the enforcement
point — so if you change one, change both.

**[`release-please-config.json`](../release-please-config.json)** — declares one
package at the repo root with `release-type: node`, which is what teaches
release-please to bump `package.json` and write `CHANGELOG.md`. `package-name` is
the npm name, used in the changelog and release titles. `include-component-in-tag`
is **`false`**, which matters: manifest mode defaults it to `true`, which would
produce `pg-schema-dump-v1.2.0` tags instead of the `v1.2.0` format the repo has
used since `v1.0.0`. `last-release-sha` is pinned to
`33832d8e56c042f8bc08b3ee9d3355a59e7eaf33`, the commit tagged `v1.1.0`: it stops
the commit scan there so the first changelog covers only post-`v1.1.0` work
instead of reaching back over the entire history.

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
  [`.nvmrc`](../.nvmrc) (`24`), and current 24.x releases bundle npm 11.17.0, so
  this is satisfied — but note Node 24.0.0 itself shipped npm 11.3.0, below the
  floor. See [Troubleshooting](#10-troubleshooting) if it ever regresses.
- **`actions/setup-node` must be v7 or newer.** v6 exports a dummy
  `NODE_AUTH_TOKEN` whenever `registry-url` is set, which makes npm attempt token
  auth and fail instead of using OIDC.

**The `prepublishOnly` gate.** `npm publish` runs the `prepublishOnly` script from
[`package.json`](../package.json) — currently `build` → `eslint` → `test`, where
`test` is the full vitest run including the Testcontainers e2e suite (which needs
Docker; `ubuntu-latest` has it). This is the last gate before the tarball is
uploaded, and it is defined in `package.json`, not here — treat that script as the
authority if the two ever disagree.

One ordering consequence worth knowing: the tag and GitHub Release are created
**before** `npm publish` runs. If the publish fails — red test, npm outage,
misconfigured trusted publisher — the tag and Release exist but npm has no such
version. Do not delete or move the tag, and do not expect a re-run to fix it (see
[How to force a release](#8-how-to-force-a-release)). Fix forward: land a commit on
`main` and let the next release go out under a new version number.

## 8. How to force a release

- **Release work made only of non-releasing types** (a docs- or chore-only batch
  you nevertheless want published): add a `Release-As:` footer to a commit on
  `main`.

  ```
  chore: refresh dependency overrides

  Release-As: 1.1.1
  ```

  This also works for jumping to a specific version deliberately (e.g. a
  pre-planned `2.0.0`). Verified behaviour: the footer forces a release PR even
  when every commit in range is a quiet type.

- **Re-run the workflow when the release PR itself failed to appear** — Actions →
  _Release Please_ → _Run workflow_ (`workflow_dispatch`, on `main`; other refs are
  refused). This is for runs that died before release-please did its work.

- **A failed publish cannot be re-driven by re-running the workflow.** Once the tag
  and GitHub Release exist, a re-run finds nothing left to release, so
  `release_created` is not set and the `publish` job is skipped — the run goes green
  having published nothing. There is no retry button for the publish leg: fix
  forward with a new commit on `main` and let the next version go out. (A
  tag-triggered publish workflow would change this, but it would also need its own
  npm Trusted Publisher entry, since npm trusts a specific workflow filename.)

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
  first release PR appears when a `fix:`/`feat:`/`revert:`/breaking commit lands —
  or immediately, if you use a `Release-As:` footer per
  [How to force a release](#8-how-to-force-a-release).
- **Releases only ever come from `main`.** Both jobs carry
  `if: github.ref == 'refs/heads/main'`, so a `workflow_dispatch` aimed at a feature
  branch does nothing at all rather than cutting a release from unreviewed code.
- **The publish builds the tagged commit, not the triggering ref.** The `publish`
  job checks out the sha release-please tagged, so the published tarball always
  matches the version it claims to be.

## 10. Troubleshooting

| Symptom                                                        | Likely cause                                                                                                                      | Fix                                                                                                                                                 |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Merged to `main`, no release PR appeared                       | Commit subjects are not Conventional Commits, or they are all quiet types (`chore`/`docs`/`test`/`ci`/`refactor`/`style`/`build`) | Check the workflow run log — it lists the commits it parsed. Land a `fix:`/`feat:` commit, or use a `Release-As:` footer                            |
| Release PR proposes an unexpected version                      | `.release-please-manifest.json` is out of sync with what is on npm, or `last-release-sha` points at the wrong commit              | Set the manifest to the version actually published, close the release PR, let the next run recompute                                                |
| Your change is missing from `CHANGELOG.md`                     | Its subject was unparseable, or its type is hidden by default (`chore`/`docs`/`test`/`ci`/`refactor`/`style`/`build`)             | Nothing to fix retroactively; use a releasing type next time. Note `revert:` is **not** hidden — it releases and appears                            |
| `npm publish` fails with `ENEEDAUTH` / OIDC or 403 errors      | No Trusted Publisher on npmjs.com, its org/repo/**workflow filename** doesn't match, or `actions/setup-node` was downgraded to v6 | Recheck the npm entry ([§ Publishing](#7-publishing-and-permissions)). If the workflow file was renamed, update the entry. Keep `setup-node` at v7+ |
| `npm publish` fails saying trusted publishing is not supported | npm CLI on the runner is older than 11.5.1                                                                                        | Add `- run: npm install -g npm@latest` immediately before the `npm publish` step in the `publish` job                                               |
| Publish failed, but the tag and Release exist                  | Expected ordering — the tag precedes the publish                                                                                  | Do not re-tag and do not re-run (a re-run skips `publish` entirely). Fix forward with a new commit and let the next version go out                  |
| The workflow ran but every job was skipped                     | It was dispatched on a branch other than `main`                                                                                   | Re-dispatch it against `main`; releases are deliberately restricted to that ref                                                                     |
| The **PR Title** check is red                                  | The PR title is not a Conventional Commit, or its type is outside the list in `pr-title.yml`                                      | Edit the PR title; the check re-runs on edit, so no new commit is needed                                                                            |
| No release PR **and** the log shows a permissions error        | Repo/org setting "Allow GitHub Actions to create and approve pull requests" is off                                                | Enable it in Settings → Actions → General → Workflow permissions                                                                                    |
| Publish succeeded but npm shows no provenance                  | Published from something other than this OIDC workflow (e.g. a laptop)                                                            | Always release through the workflow; `npm publish` from a laptop is no longer part of the process                                                   |

## 11. Reference

- Conventional Commits 1.0.0 — <https://www.conventionalcommits.org/en/v1.0.0/>
- release-please — <https://github.com/googleapis/release-please>
- release-please configuration reference — <https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md>
- `googleapis/release-please-action` — <https://github.com/googleapis/release-please-action>
- npm trusted publishing — <https://docs.npmjs.com/trusted-publishers>
