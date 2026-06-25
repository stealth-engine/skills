---
name: pooled-release
description: "Cut fewer, batched releases (a 'release train') instead of one per merge — by triggering semantic-release on demand or on a cadence rather than on every push to main. Use when releasing on every merge is too noisy, when you want one larger readable changelog per release, to add a manual 'cut a release' button (workflow_dispatch) or a scheduled/weekly release, to set up prerelease channels (beta/next → promote to stable), or when deciding whether you need a release branch. Builds on semantic-release-automation — only the trigger changes. Covers why pooling doesn't slow development, and when release branches are (rarely) worth it."
metadata:
  author: stealth-engine
  version: "1.0.0"
---

# Pooled releases (release trains)

Release on every merge is great for a fast-moving lib, but sometimes you want
**fewer, fatter releases** — one readable changelog per cut, not a version bump per
PR. This skill does that **without changing how you develop**: it only changes the
release **trigger**. It builds directly on
[`semantic-release-automation`](../semantic-release-automation/SKILL.md) — same
plugin pipeline, same Conventional Commits; read that first.

## The key idea: decouple *merge* from *release*

Trunk-based development still wants frequent small merges to `main` — that's
unchanged, so **dev velocity and PR flow don't change**. The only thing you move is
**when a release is published**:

| | Trigger | Result |
| --- | --- | --- |
| **Per-merge (default)** | `on: push: [main]` | a release every qualifying merge — many small ones |
| **Pooled (this skill)** | `workflow_dispatch` and/or `schedule` | semantic-release batches **all** commits since the last tag into **one** release |

semantic-release already does the batching — it always releases "everything since the
last tag." Pooling just means you tag **less often**.

## Pick a model

Use [`templates/release-on-demand.yml`](./templates/release-on-demand.yml) for the
first two; it ships with `workflow_dispatch` on and `schedule` commented.

1. **Manual button — `workflow_dispatch`** *(recommended default).* Cut a release
   when you decide it's worth one (Actions tab → Run workflow). Simplest; no surprise
   releases; no release branch.
2. **Cadence — `schedule`.** Uncomment the `cron` for an automatic train (e.g. weekly).
   Good when you want predictable, regular cuts. (Combine with the button if you like.)
3. **Prerelease channels — `beta`/`next`.** Continuous prereleases on a `next`/`beta`
   branch, promoted to a batched stable cut on `main`. Use
   [`templates/releaserc.prerelease-channels.json`](./templates/releaserc.prerelease-channels.json)
   (the `branches` config) — merge work to `next` for `x.y.z-next.N` prereleases, then
   fast-forward `main` for the stable release.

## Release branches — usually don't

A long-lived `release/x.y` branch is real trunk-based practice but only pays off when
you must **stabilise/QA a release while trunk keeps moving**, or **support multiple
live versions** at once. It costs you hotfix cherry-picking and snapshot maintenance.
For a single-version app/CLI, **skip it** — pooling via trigger (above) gives you the
batched releases without the branch overhead.

## What changes vs the per-merge setup

Start from `semantic-release-automation`'s `release.yml` and:

- **Replace the trigger** — drop `on: push: [main]`; add `workflow_dispatch` (and/or
  `schedule`).
- **Drop the no-loop guard** — with no `on: push`, the `chore(release): …` commit
  semantic-release pushes can't re-trigger the workflow, so the
  `if: !startsWith(... 'chore(release):')` guard is unnecessary.
- **Everything else is identical** — plugin pipeline, `fetch-depth: 0`,
  `$GITHUB_SERVER_URL` repo URL, tokens, npm publish.

## Gotchas

- **`schedule` only runs once the workflow file is on the default branch** — merge it
  to `main` before expecting cron to fire; `cron` is UTC.
- **`fetch-depth: 0` still required** (full history + tags for the batched analysis).
- **`concurrency: { group: release }`** so a manual run and a scheduled run can't
  collide on the tag push.
- **Big gaps → big changelogs.** That's the point, but communicate the cadence so
  contributors know when their merged work actually ships.
- **A pooled release can still gate a deploy** — pair with
  [`production-release-gating`](../production-release-gating/SKILL.md) (deploy on the
  published Release / the release commit), so prod ships on the train, not on merges.
- **Prerelease channels need the branch to exist** and work pushed to it; the stable
  cut happens when `next`/`beta` reaches `main`.

## Verify

- `npx semantic-release --dry-run` on `main` prints the **batched** next version and
  the full accumulated release notes — without publishing.
- Manual: Actions tab → the workflow → **Run workflow**. Scheduled: confirm the cron
  in the default-branch copy of the file.

## See also

- [`semantic-release-automation`](../semantic-release-automation/SKILL.md) — the
  pipeline this reuses; pooling only swaps the trigger.
- [`conventional-commits`](../conventional-commits/SKILL.md) — what the batched
  changelog is built from.
- [`production-release-gating`](../production-release-gating/SKILL.md) — deploy on the
  pooled release rather than on every merge.

## Sources

- semantic-release branches/channels config (prerelease `next`/`beta`):
  <https://semantic-release.gitbook.io/semantic-release/usage/configuration#branches>
- Trunk-based development & release strategies: <https://trunkbaseddevelopment.com/>,
  Atlassian's TBD guide, and the semantic-release TBD discussion (#2041). The
  decouple-merge-from-release framing and "release branches only when you must
  stabilise/QA or support multiple live versions" come from those.
