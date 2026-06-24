---
name: production-release-gating
description: "Stop every push/merge to main from shipping to production — deploy only on a real release. Use when a merge to main unexpectedly deploys to prod, when you want production to deploy only on a semantic-release version (not every commit), when setting up preview-on-feature-branch but gated-prod-on-main, wiring a Vercel Ignored Build Step / `ignoreCommand`, or triggering a deploy from a published GitHub Release (GKE, self-hosted, dispatchable targets). Covers the two patterns — release-event-driven deploy (`on: release`, `types: [published]`) and the Vercel `ignoreCommand` script — when to use which, branch-aware previews, and monorepo dependency-release handling."
metadata:
  author: stealth-engine
  version: "1.0.0"
---

# Gating production deploys to real releases

By default a push/merge to `main` deploys to production. With
[semantic-release](../semantic-release-automation/SKILL.md) you usually want the
opposite: **previews on feature branches, but production only on an actual
release** (a versioned `chore(release):` commit / a published GitHub Release).
There are two ways to enforce that — pick by **who deploys**.

| | **Pattern A — release-event-driven** | **Pattern B — Vercel `ignoreCommand`** |
| --- | --- | --- |
| Who deploys | a workflow **you** control (GKE, self-hosted, anything dispatchable) | the **platform** auto-deploys every push (Vercel/Netlify git integration) |
| The gate | nothing deploys on push; a **published GitHub Release** triggers the deploy | a script tells the platform to **skip** the build unless it's a release commit |
| GitHub Release role | the **trigger** (and a live deploy-status surface) | a record |
| Template | [`templates/release-production.yml`](./templates/release-production.yml) | [`templates/vercel-ignore.sh`](./templates/vercel-ignore.sh) |

**Decision rule:** does your platform force-deploy on every push? → Pattern B.
Otherwise (you own the deploy workflow) → Pattern A — it's the cleaner model.

## Pattern A — deploy on a published Release

semantic-release creates a GitHub Release; this workflow fires on `on: release`
with `types: [published]` and rolls out `github.event.release.tag_name`, then
writes the deploy status back onto the Release body. Plain pushes to `main` deploy
nothing.

- **Token caveat:** a Release created with the built-in `GITHUB_TOKEN` will **not**
  trigger `on: release`. Have semantic-release run with a **PAT/bot `GH_TOKEN`** so
  its Release fires this workflow. (See `semantic-release-automation` → token notes.)
- `concurrency` with `cancel-in-progress: false` so a rollout is never half-killed.

## Pattern B — Vercel Ignored Build Step

Vercel runs an **Ignored Build Step** before building; its exit code decides:
**`exit 1` = build, `exit 0` = skip** (note the inversion). Wire
[`templates/vercel-ignore.sh`](./templates/vercel-ignore.sh) via `vercel.json`
(`"ignoreCommand": "bash ../../scripts/vercel-ignore.sh"`) or Project Settings →
Git → Ignored Build Step. Logic:

- **Feature branch →** build (preview deployment). This is the whole point of
  previews; don't gate them.
- **`main`, release commit** (`chore(release): …` / `chore(scope): release …`) **or
  `[deploy]` marker →** build (production).
- **`main`, anything else →** skip.
- **`[skip-deploy]`** on any branch → skip.

**Monorepo:** Vercel's "Skipping Unaffected Projects" is layer 1 (Turborepo graph);
this script is layer 2. A per-app script also builds when a **dependency package**
releases — add a clause like `^chore\((configs|i18n-routing)\):.*release` (shown
commented in the template) so an app redeploys when its shared lib version bumps.

## Gotchas

- **Exit codes are inverted** in the Vercel ignore step (0 = skip). The single most
  common mistake.
- **Preview vs prod:** keep feature-branch previews ungated; only `main` is strict.
  Gating previews defeats the workflow.
- **Pattern A needs a non-default token** on the release side, or the Release won't
  trigger the deploy (silent no-op).
- **Don't gate in two places at once.** Pick A or B per app; doubling up makes "why
  didn't it deploy?" much harder to debug.
- **`[skip ci]` in the release commit** (the monorepo semantic-release flavor) means
  push-triggered workflows won't see it — which is exactly why Pattern A keys on the
  *Release event*, not the push.

## See also

- [`semantic-release-automation`](../semantic-release-automation/SKILL.md) — produces
  the release commit / GitHub Release this gate keys on.
- [`conventional-commits`](../conventional-commits/SKILL.md) — why the release commit
  looks like `chore(release): …`.

## Sources

- Generalised from production repos: `cphk` (Pattern A — `on: release` /
  `types: [published]` dispatches a GKE deploy and annotates the Release with status)
  and `piaf-monorepo`
  (Pattern B — per-app `vercel.json` `ignoreCommand` → `vercel-ignore-<app>.sh` with
  branch/release/dependency-aware exit codes).
- Vercel Ignored Build Step: <https://vercel.com/docs/projects/overview#ignored-build-step>
