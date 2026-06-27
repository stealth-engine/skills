---
name: production-release-gating
description: "Stop every push/merge to main from shipping to production — deploy only on a real release. Use when a merge to main unexpectedly deploys to prod, when you want production to deploy only on a semantic-release version (not every commit), when setting up preview-on-feature-branch but gated-prod-on-main, wiring a Vercel Ignored Build Step / `ignoreCommand`, promoting to a staging/`production` branch, or triggering a deploy from a published GitHub Release (GKE, self-hosted, dispatchable targets). Covers three patterns — release-event-driven deploy (`on: release`, `types: [published]`), the staging/production-branch promotion (most portable), and the Vercel `ignoreCommand` script — when to use which, works with both per-merge and pooled releases, branch-aware previews, and monorepo dependency-release handling."
metadata:
  author: stealth-engine
  version: "1.1.0"
---

# Gating production deploys to real releases

By default, a push/merge to `main` deploys to production. With
[semantic-release](../semantic-release-automation/SKILL.md) you usually want the
opposite: **previews on feature branches, but production only on an actual
release** (a versioned `chore(release):` commit / a published GitHub Release).
There are three ways to enforce that — pick by **who deploys** and **how portable**
you need it.

| | **A — release-event** | **B — Vercel `ignoreCommand`** | **C — staging / `production` branch** |
| --- | --- | --- | --- |
| Who deploys | a workflow **you** control (GKE, self-hosted, dispatchable) | the **platform** auto-deploys every push | the platform's **native git integration**, but only off `production` |
| The gate | a **published Release** triggers the deploy; plain pushes deploy nothing | a script tells the platform to **skip** unless it's a release commit | `production` only **advances on a published Release**; `main` = staging |
| Portability | any dispatchable target | **Vercel/Netlify only** (platform script) | **any host with a configurable production branch** (Vercel, Netlify, CF Pages) — most portable |
| Template | [`release-production.yml`](./templates/release-production.yml) | [`vercel-ignore.sh`](./templates/vercel-ignore.sh) | [`promote-to-production.yml`](./templates/promote-to-production.yml) |

**Decision rule:**
- Want to keep the platform's **native git deploys** with **zero platform-specific
  scripting**? → **C** (set the production branch, promote on release). Most portable.
- **You** own the deploy (GKE/self-hosted/any dispatchable target)? → **A** — cleanest
  when nothing force-deploys for you.
- Locked into a platform's push-deploy and **can't** add a branch/promotion? → **B**
  (the ignore script) as the fallback.

## Works with both per-merge and pooled releases — pick the flow, then record it

All three gates are **orthogonal to release cadence**: they key on the
`chore(release):` commit + tag + published GitHub Release, which is produced
identically whether you release on **every merge**
([`semantic-release-automation`](../semantic-release-automation/SKILL.md)) or in
**batches** ([`pooled-release`](../pooled-release/SKILL.md)). So the same gate works
under either workflow — you don't re-pick it if you later switch cadence.

Because the gate is a **lasting repo convention** (and double-gating is a real
footgun — see Gotchas), when wiring this up for a project:

1. **Confirm the flow with the user — don't assume.** Which pattern (A/B/C)? Which
   branch is production? Which platform? Per-merge or pooled release trigger?
2. **Record the decision so it's durable and visible.** Write a short line in the
   repo's `AGENTS.md` (and/or the deploy workflow header), e.g.
   *"Prod gating: Pattern C — production branch `production`, platform Vercel,
   pooled release."* Future agents and humans then follow the same flow instead of
   re-deriving — or silently contradicting — it.

## Pattern A — deploy on a published Release

semantic-release creates a GitHub Release; this workflow fires on `on: release`
with `types: [published]` and rolls out `github.event.release.tag_name`, then
writes the deploy status back onto the Release body. Plain pushes to `main` deploy
nothing.

- **The deploy step is whatever command you control** — that's the point of "you
  deploy." The template shows a GKE/`kubectl` rollout, but the same job can call a
  **platform CLI** (`vercel deploy --prod --prebuilt`, `netlify deploy --prod`), hit
  a **deploy hook** (`curl "$DEPLOY_HOOK_URL"`), `wrangler deploy`, `flyctl deploy`,
  etc. The gate (fire only on the published Release) is identical; only the rollout
  command differs.
- **A → vs the platform's own git deploy:** use Pattern A's CLI when you want CI to
  *own* the prod deploy. If you'd rather keep the platform's **native** git
  integration and just gate which branch it watches, that's **Pattern C** instead.
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

## Pattern C — staging / `production`-branch promotion

The most **portable** gate: keep the platform's native git deploys, but point its
**Production Branch at a dedicated `production` branch** instead of `main`. Now `main`
is a preview/staging branch (deploys on every merge, but not to prod), and prod ships
only when `production` advances. [`templates/promote-to-production.yml`](./templates/promote-to-production.yml)
fires on the published Release and **fast-forwards `production` to the released
commit**; the platform's webhook then deploys it. No platform CLI, no ignore script —
just a branch update, so it works on Vercel, Netlify, Cloudflare Pages, anything with
a configurable production branch.

- **Setup is one-time:** create `production` off `main`, set it as the platform's
  Production Branch, and run semantic-release with a **PAT/bot `GH_TOKEN`** (same
  token caveat as Pattern A — the built-in token's Release won't fire `on: release`).
- **`production` only ever fast-forwards** from `main`, so it stays an ancestor of the
  release commit and the promotion push is always a clean fast-forward. A rejected
  (non-fast-forward) push is a real divergence to inspect — **never `--force` past it.**
- **Pairs naturally with [`pooled-release`](../pooled-release/SKILL.md):**
  semantic-release runs on `main` (button/cron) and tags; this promotes the tag to
  prod. Merges to `main` keep shipping staging; prod ships on the train.

## Gotchas

- **Exit codes are inverted** in the Vercel ignore step (0 = skip). The single most
  common mistake.
- **Preview vs prod:** keep feature-branch previews ungated; only `main` is strict.
  Gating previews defeats the workflow.
- **Pattern A needs a non-default token** on the release side, or the Release won't
  trigger the deploy (silent no-op).
- **Don't gate in two places at once.** Pick **one** of A / B / C per app; doubling up
  (e.g. a `production` branch *and* an ignore script) makes "why didn't it deploy?"
  much harder to debug.
- **Pattern C: don't leave `main` as the platform's production branch.** The whole
  gate is moving the Production Branch to `production`; forget that step and every
  merge to `main` still ships to prod.
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
- Pattern C builds on each platform's configurable **production branch** primitive:
  Vercel (Project → Settings → Git → Production Branch) and Netlify (Site
  configuration → Build & deploy → Branches → Production branch). Promoting via a
  fast-forward of `production` is a generalisation of that native feature, so the gate
  stays platform-agnostic.
