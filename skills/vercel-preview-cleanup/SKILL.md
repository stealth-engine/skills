---
name: vercel-preview-cleanup
description: "Install a GitHub Actions workflow that deletes a branch's Vercel PREVIEW deployments when that branch is deleted — every deployment it accumulated, not just the aliased URL (Vercel keeps one immutable deployment per push, so a 15-push branch leaves 15 live URLs). Requires Vercel; if you just want stale git branches deleted, use the branch-cleanup skill instead. Use when asked to clean up / delete orphaned Vercel preview deployments, stop preview deployments piling up, remove previews for merged or deleted branches, wire an `on: delete` cleanup workflow, reconcile Vercel deployments against branches that still exist, back-fill deletion of previews already accumulated, or do Vercel deployment housekeeping across a monorepo's projects."
metadata:
  author: stealth-engine
  co-author: wiiiimm
  version: "1.0.0"
---

# Vercel preview cleanup

Authors a GitHub Actions workflow that removes a branch's preview deployments once the
branch is gone. **This skill installs workflows; it never deletes anything itself.** At
runtime there is no agent and no model call — deterministic bash + `curl` only.

Verified API detail (endpoints, pagination, rate limits, retention) lives in
[`reference/vercel-api.md`](./reference/vercel-api.md) — read it before changing the
delete logic.

## Step 0 — prerequisites (check before installing)

This skill is **downstream of branch deletion**. If branches are never deleted, the
`delete` event never fires and this workflow looks broken when it isn't.

1. **`delete_branch_on_merge` is on:**
   `gh api repos/{owner}/{repo} --jq .delete_branch_on_merge`
   → if `false`, install [`branch-cleanup`](../branch-cleanup/SKILL.md) first (it enables
   this and adds the closed-unmerged + orphan-sweep paths).
2. **A branch-cleanup workflow exists** (`.github/workflows/` — closed-unmerged path).
   Without it, only *merged* branches get deleted; abandoned ones linger forever and so
   do their previews.

**Install `branch-cleanup` first.** It is the prerequisite, not an optional companion.

> Neon's Vercel integration reaps preview *database* branches when the git branch
> disappears — no code needed here. It is another reason timely branch deletion matters.

## The problem this solves

Vercel creates a **new immutable deployment per push**. The branch alias repoints to the
newest; every older deployment stays live at its own URL. A branch with 15 pushes leaves
**15 reachable deployments**. Deleting the branch removes none of them. You must
enumerate and delete *all* of them.

## Why `on: delete`, not `pull_request: closed`

- Deployments are keyed to the **branch**, not the PR. A branch pushed without a PR still
  produces deployments; a PR-close trigger never sees them.
- `delete` fires however the branch went away — merge auto-delete, manual, or `gh pr
  merge --delete-branch`.
- In stacked workflows PRs close and reopen during restacks. A PR-close trigger would
  delete previews for stack entries still in active use.

### `delete` event caveats (all handled in the templates)

| Caveat | Handling |
| --- | --- |
| Fires for **tags** too | every job gated on `github.event.ref_type == 'branch'` |
| **No branch filter** supported (unlike `push`) | filtered in-job; expect noisy run history |
| Workflow must exist on the **default branch** | documented in the caller; it runs the default-branch definition because the branch is already gone |
| `github.ref` is useless here (resolves to default branch) | read `github.event.ref` |
| `github.event.ref` is the **bare name** | do **not** strip a `refs/heads/` prefix that isn't there |
| Documented cap: not triggered when deleting **>3 tags** at once (branch equivalent unverified) | the reconciliation sweep is the backstop either way |

## The four safety layers

Deleting the wrong thing here means destroying a production deployment, so the guards are
layered and independent:

1. **`on: delete` only** — the workflow only ever runs for a branch that is *already
   gone*. It cannot touch a live branch's previews.
2. **Include pattern `*/*`** (default) — only branches containing a `/` are cleaned, so
   flat trunks (`main`, `master`, `develop`, `staging`, `production`) can never match.
3. **Protected denylist** — `release/*` and `hotfix/*` **do contain a slash** and would
   pass layer 2, so they're denied explicitly. Layer 2 alone is not sufficient.
4. **`target != "production"` in code** — the hard guard, applied to every listed
   deployment. ⚠️ Preview deployments carry **`target: null`, not `"preview"`** —
   selecting `.target == "preview"` matches *zero* rows and silently deletes nothing.

Every skipped branch is written to `$GITHUB_STEP_SUMMARY`, so a filter can never orphan
deployments silently.

## Runtime behaviour

1. List every deployment for the branch — `GET /v7/deployments`, scoped by `projectId`,
   `teamId`, `branch`.
2. **Paginate to exhaustion.** `pagination.next` is a **millisecond timestamp** passed
   back as `until`; stop only when it is `null`. Partial pagination silently orphans the
   *oldest* deployments — the exact problem being solved.
3. Filter: drop `target == "production"` and already-deleted tombstones
   (delete is a *soft* delete — they reappear in later lists).
4. Delete each, **paced at ~1 per 3 s**. Vercel allows **200 deletes per 600 s per team**;
   a collapsing stack or a backfill will hit it. `200`/`404`/`410` all count as success.

## Install

1. Host [`templates/reusable-vercel-preview-cleanup.yml`](./templates/reusable-vercel-preview-cleanup.yml)
   **once** in the org's `.github` repo. Do not copy it per repo.
2. Add [`templates/caller-vercel-preview-cleanup.yml`](./templates/caller-vercel-preview-cleanup.yml)
   to each repo's default branch (~30 lines).
3. Set per-repo `vars.VERCEL_PROJECT_IDS` (comma-separated — a monorepo maps one git repo
   to several Vercel projects) and `vars.VERCEL_TEAM_ID`; set `secrets.VERCEL_TOKEN`.
4. **Private repos:** the hosting repo's Actions access settings must permit other org
   repos to call its reusable workflows, or every caller fails.
5. **Test via `workflow_dispatch` with `dry_run: true`** — you cannot test `on: delete`
   from a feature branch.

Installation is idempotent: if a workflow already exists, diff it and offer an upgrade —
never clobber local edits without showing them first. Validate generated YAML
(`actionlint` if available, otherwise a YAML parse) before writing.

## Deliberately not built

- **No cross-branch dependency check.** Deployments are immutable and branch-scoped —
  unlike branches, nothing else can depend on one. A later pass should not add a
  "does anything else use this deployment" guard; there is nothing to check.
- **Fork PR deployments are never swept.** There is no branch in this repo to delete, so
  `on: delete` never fires for them. They age out via Vercel's retention.
- **Retention is not a substitute.** It's an independent backstop with its own floor
  (last 10 project deployments, last 20 READY non-production, the latest preview of an
  *active* branch, …) and `deploymentsToKeep` is **production-only**. See
  [`reference/vercel-api.md`](./reference/vercel-api.md).

## Backfill

The workflow only affects branches deleted **from now on**. For deployments already
accumulated, run [`scripts/vercel-backfill.sh`](./scripts/vercel-backfill.sh) once —
dry-run by default, same four guards, same pacing.

## See also

- [`branch-cleanup`](../branch-cleanup/SKILL.md) — **the prerequisite.** Deletes the
  branches whose deletion triggers this skill. Install it first; it also works standalone
  for repos with no Vercel.
