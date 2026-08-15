---
name: vercel-preview-cleanup
description: "Install a GitHub Actions workflow that deletes a branch's Vercel PREVIEW deployments when that branch is deleted — every deployment it accumulated, not just the aliased URL (Vercel keeps one immutable deployment per push, so a 15-push branch leaves 15 live URLs). Requires Vercel; if you just want stale git branches deleted, use the branch-cleanup skill instead. Use when asked to clean up / delete orphaned Vercel preview deployments, stop preview deployments piling up, remove previews for merged or deleted branches, wire an `on: delete` cleanup workflow, reconcile Vercel deployments against branches that still exist, back-fill deletion of previews already accumulated, or do Vercel deployment housekeeping across a monorepo's projects."
metadata:
  author: stealth-factory
  co-author: wiiiimm
  version: "1.0.1"
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

1. **The branch must be gone** — `on: delete` guarantees it, and because
   `workflow_dispatch` does *not*, branch mode explicitly verifies the branch is absent
   before deleting anything. (Without that check a dispatch could wipe a *live* branch's
   previews, including the aliased one.)
2. **Include pattern `*/*`** (default) — only branches containing a `/` are cleaned, so
   flat trunks (`main`, `master`, `develop`, `staging`, `production`) can never match.
3. **Protected denylist** — `release/*` and `hotfix/*` **do contain a slash** and would
   pass layer 2, so they're denied explicitly. Layer 2 alone is not sufficient.
4. **`target != "production"` in code** — the hard guard, applied to every listed
   deployment. ⚠️ Preview deployments carry **`target: null`, not `"preview"`** —
   selecting `.target == "preview"` matches *zero* rows and silently deletes nothing.

Both guards are re-applied per-candidate **in the sweep too**, not just on the event
path — and because deletes are paced at ~3 s each, the sweep **re-verifies each ref is
still absent immediately before deleting** rather than trusting the live-ref snapshot it
built at the start (a branch recreated mid-sweep would otherwise lose its previews). The step summary reports counts per run (found / deleted / kept / failed) — enough
to notice a filter that's excluding everything, though it does not list every kept ref.

## Runtime behaviour

1. List every deployment for the branch — `GET /v7/deployments`, scoped by `projectId`,
   `teamId`, `branch`.
2. **Paginate to exhaustion.** `pagination.next` is a **millisecond timestamp** passed
   back as `until`; stop only when it is `null`. Partial pagination silently orphans the
   *oldest* deployments — the exact problem being solved.
3. Filter: drop `target == "production"` and already-deleted tombstones
   (delete is a *soft* delete — they reappear in later lists).
4. Cross-check each deployment's ref client-side before deleting — never trust the
   server-side `branch=` filter alone.
5. Delete each, **paced at ~1 per 3 s**. Vercel allows **200 deletes per 600 s per team**;
   a collapsing stack or a backfill will hit it. `200`/`404`/`410` all count as success.

## Install

1. Host [`templates/reusable-vercel-preview-cleanup.yml`](./templates/reusable-vercel-preview-cleanup.yml)
   **once** in the org's `.github` repo. Do not copy it per repo.
2. Add [`templates/caller-vercel-preview-cleanup.yml`](./templates/caller-vercel-preview-cleanup.yml)
   to each repo's default branch (~30 lines). **Replace `YOUR-ORG`** and keep the
   `uses:` pinned to a **full commit SHA** (the template ships an obvious
   placeholder so it cannot silently run unpinned; a tag is mutable and can be moved). It forwards a delete-capable token; `@main` would let any change there
   take effect across every repo at once.
3. Set per-repo `vars.VERCEL_PROJECT_IDS` (comma-separated — a monorepo maps one git repo
   to several Vercel projects) and `vars.VERCEL_TEAM_ID`; set `secrets.VERCEL_TOKEN`.
4. **Private repos:** the hosting repo's Actions access settings must permit other org
   repos to call its reusable workflows, or every caller fails.
5. **Test via `workflow_dispatch` with `dry_run: true`** — you cannot test `on: delete`
   from a feature branch.

Installation is idempotent: if a workflow already exists, diff it and offer an upgrade —
never clobber local edits without showing them first. Validate generated YAML
(`actionlint` if available, otherwise a YAML parse) before writing.

## Fork PRs — the event path does NOT cover them

**Be clear about this before installing.** A fork PR's branch lives in *the fork*, so:

- `on: delete` **never fires** for it — there is no ref in your repo to delete.
- It never appears in `repos/{owner}/{repo}/branches`.

The only trigger that *could* clean a fork PR's previews the moment it closes is
**`pull_request_target`**, and this skill **deliberately does not use it**. That trigger
runs with your secrets in the base repo's context; combined with a `VERCEL_TOKEN` that can
delete deployments, it is a supply-chain surface — and one `actions/checkout` added by a
later edit turns it into remote code execution. Not worth it for this feature. If your org
accepts that trade-off, the wiring is a `pull_request_target: [closed]` job gated to
`head.repo.full_name != github.repository`; adopt it knowingly, and **never check out fork
code in it**.

**What you actually get instead:**

| Fork PR state | Behaviour |
| --- | --- |
| **Open** | previews are **protected** — the sweep's "still live" set is `repo branches ∪ every open PR head ref`, so an in-review fork PR's previews are never deleted (without this union they'd look like orphans and be swept mid-review) |
| **Closed / merged** | the ref is neither a branch nor an open PR head → the **sweep collects it** on its next run |

So forks *are* cleaned — just on the sweep's cadence (daily by default) rather than
instantly. Two honest caveats:

1. **Latency.** A fork PR's previews stay live until the next sweep. Tighten the cron if
   that matters.
2. **Flat-named fork branches are never swept.** GitHub's web editor defaults to
   `patch-1`, which has no `/` and so fails the `*/*` include guard by design. Those
   previews persist until Vercel's retention reaps them. Widening the pattern to catch
   them would also expose your own flat trunks — not a trade worth making.

## Rolling out across many repos

- **Pin the reusable workflow to a full commit SHA.** It holds delete
  permissions; `@main` means every repo silently picks up any change to it.
- **Replace `YOUR-ORG`** in the caller's `uses:` with your organisation.
- **`VERCEL_PROJECT_IDS` misconfiguration is the top operational hazard.** Point a repo
  at a project belonging to a *different* repo and the sweep sees all of that project's
  refs as orphans. Verify the mapping per repo before enabling `sweep_delete`.
- **Watch for failing sweeps.** A daily sweep that errors is a red run nobody reads —
  route the workflow's failure notifications somewhere a human sees.

## Deliberately not built

- **No cross-branch dependency check.** Deployments are immutable and branch-scoped —
  unlike branches, nothing else can depend on one. A later pass should not add a
  "does anything else use this deployment" guard; there is nothing to check.
- **No `pull_request_target`.** It's the only trigger that could clean fork PR previews
  on close, and it runs with secrets in the base repo's context. Declined deliberately —
  see "Fork PRs" above for what covers them instead.
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
