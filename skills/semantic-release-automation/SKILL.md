---
name: semantic-release-automation
description: "Automate versioning, changelog, tags, GitHub Releases, and npm publishing from Conventional Commits with semantic-release. Use when setting up or debugging automated releases, wiring a `.releaserc` / `release` config and the plugin pipeline (commit-analyzer, release-notes-generator, changelog, npm, git, github), making `main` cut a version on merge, generating CHANGELOG.md, publishing to npm or creating a GitHub Release per release, doing per-package releases in a monorepo (per-package tags + paths-filter matrix), pooling commits into a less-frequent release, or fixing a release that didn't fire / a CI loop from the release commit. Covers the single-package and monorepo flavors and the GitHub Actions workflow."
metadata:
  author: stealth-engine
  version: "1.0.0"
---

# semantic-release automation

[semantic-release](https://github.com/semantic-release/semantic-release) reads
[Conventional Commits](../conventional-commits/SKILL.md), computes the next semver
version, writes the changelog, tags, and **registers a GitHub Release** (and
optionally publishes to npm) — all in CI, no manual version bumps. This skill is
the tooling that consumes the commit format; read `conventional-commits` first for
how the bump is decided.

Copy-paste configs: [`templates/`](./templates) — a single-package config, a
monorepo per-package config, and the GitHub Actions workflow.

## How a release happens

1. You merge a PR to `main` (squash; the **PR title** is the Conventional Commit).
2. The workflow runs `semantic-release`, which:
   - **commit-analyzer** → reads commits since the last tag, decides major/minor/patch (or no release).
   - **release-notes-generator** → builds the notes from those commits.
   - **changelog** → writes/updates `CHANGELOG.md`.
   - **npm** *(optional)* → bumps `package.json` and publishes to npm.
   - **git** → commits `CHANGELOG.md`/`package.json` back as `chore(release): X.Y.Z` and tags it.
   - **github** → creates the **GitHub Release** (the canonical record of what shipped).

If no commit since the last release warrants a bump (only `chore`/`docs`/…), it
does nothing — correct, not a failure.

## Where config lives

Either a **`.releaserc.json`** at the repo/package root, or a **`"release"`** key
in `package.json`. Both are equivalent; pick one. Plugin **order matters** — it's
the execution pipeline, and `npm` must run before `git` so the bumped
`package.json` is what gets committed.

## Flavor 1 — single package (npm or app)

Use [`templates/releaserc.single-package.json`](./templates/releaserc.single-package.json).
- Publishing to **npm**: keep `@semantic-release/npm`.
- **Not** publishing (a deployed app, or a private package): **drop**
  `@semantic-release/npm` (or set `["@semantic-release/npm", { "npmPublish": false }]`
  to still bump `package.json` without publishing).

## Flavor 2 — monorepo, per-package releases

Each package gets its **own** `.releaserc.json` with a package-scoped
**`tagFormat`** (`my-app-v${version}`) so versions/tags don't collide — see
[`templates/releaserc.monorepo-package.json`](./templates/releaserc.monorepo-package.json).
The workflow detects **which packages changed** with `dorny/paths-filter` and runs
`semantic-release` once per changed package (a matrix), `max-parallel: 1` with a
`git pull --rebase` retry so concurrent tag pushes don't collide.

- **Replace `my-app`** in both `tagFormat` and the git commit `message` with the
  real package name — otherwise every package shares one tag and the deploy gate
  can't match the scope. The template's `exec` step bumps `package.json` **inline**
  (no external script to create); swap in a script only if you need extra prepare
  steps.
- **The matrix workflow isn't shipped as a template.** [`templates/release.yml`](./templates/release.yml)
  is the single-package one; for a monorepo, wrap that same `semantic-release` call
  in a `dorny/paths-filter` → matrix job (`max-parallel: 1`, `git pull --rebase`
  retry). See `piaf-monorepo`'s `release.yml` for a full example.
- **Which package releases** comes from changed **file paths** (paths-filter), and
  the bump from the commit/PR-title **type**. Keep a PR to **one package** so the
  squash commit maps cleanly. For strict per-package *commit attribution*, add
  [`semantic-release-monorepo`](https://github.com/pmowrer/semantic-release-monorepo)
  (it filters commits to those touching the package); plain semantic-release reads
  repo-wide history.
- The monorepo template's git message carries `[skip ci]` and uses a `[skip ci]`-
  aware deploy gate — see [`production-release-gating`](../production-release-gating/SKILL.md).

## The GitHub Actions workflow

Use [`templates/release.yml`](./templates/release.yml). Non-negotiables:

- **`fetch-depth: 0`** — semantic-release needs full history + tags.
- **Don't loop:** the `chore(release): …` commit it pushes would re-trigger the
  workflow. Guard with `if: !startsWith(github.event.head_commit.message, 'chore(release):')`
  (this template) **or** put `[skip ci]` in the release commit message (the
  monorepo template) if your CI honours it.
- **Token:** the built-in `GITHUB_TOKEN` works for tags/Releases, but commits it
  makes **won't trigger other workflows**. If a release must kick off a downstream
  deploy via `on: push`/`on: release`, use a **PAT/bot `GH_TOKEN`**. (See
  `production-release-gating` for the `on: release: published` pattern, which sidesteps this.)

## Pool commits into fewer releases

Don't want a release on every merge? Keep merging to `main` continuously (trunk),
but **change the trigger**: drop `on: push` and run the release on
`workflow_dispatch` (a manual "cut a release" button) and/or a `schedule:`.
semantic-release batches every commit since the last tag into one larger release —
no release branch needed. For continuous prereleases, add a `next`/`beta` branch to
`branches` (channel releases) and fast-forward to `main` for the stable cut.

## Gotchas

- **Plugin order is the pipeline.** `commit-analyzer` → `notes` → `changelog` →
  `npm` → `git` → `github`. Both `changelog` **and** `npm` must come **before**
  `git` — `git` commits the files they produce/bump, so a wrong order commits a
  stale `CHANGELOG.md`/`package.json`.
- **`EMISMATCHGITHUBURL` after an org/repo rename** — `package.json`'s `repository`
  field desyncs from the live URL. Pass `--repository-url "https://github.com/${GITHUB_REPOSITORY}.git"`
  (the template does).
- **Nothing published?** Check: was the merged commit/PR-title a *releasable* type
  (`feat`/`fix`/breaking, not `chore`)? Is `fetch-depth: 0` set? Is the branch in
  `branches`? A non-conventional title silently yields no release.
- **`NPM_TOKEN`** needs publish rights (and 2FA set to "automation"/auth-token, not
  OTP) for `@semantic-release/npm`.
- **Don't hand-write `chore(release):` commits** — they're the bot's output.

## Verify

`npx semantic-release --dry-run` on a branch prints the next version and release
notes **without** publishing — the fastest way to confirm your config and that the
commits produce the bump you expect.

## See also

- [`conventional-commits`](../conventional-commits/SKILL.md) — the input format
  that decides the version bump.
- [`production-release-gating`](../production-release-gating/SKILL.md) — deploy only
  on a real release (the GitHub Release / `chore(release):` commit this produces).
- [`git-trunk-branch-and-pr-automation`](../git-trunk-branch-and-pr-automation/SKILL.md)
  — squash + semantic PR title that becomes the commit analysed here.

## Sources

- semantic-release docs & plugin pipeline: <https://semantic-release.gitbook.io/semantic-release/>
- Default release rules (`angular` preset): <https://github.com/semantic-release/commit-analyzer/blob/master/lib/default-release-rules.js>
- Patterns generalised from production repos: `gh-manager-cli` (single-package, npm
  publish, `config in package.json`, no-loop `if` guard, `--repository-url` fix) and
  `piaf-monorepo` (per-package `.releaserc` + `tagFormat`, `dorny/paths-filter`
  matrix, `@semantic-release/exec` prepare step, `[skip ci]` release commit).
