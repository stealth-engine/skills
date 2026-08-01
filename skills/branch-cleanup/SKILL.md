---
name: branch-cleanup
description: "Install GitHub Actions workflows that delete stale git branches safely — the closed-without-merging path plus a scheduled orphan sweep — and enable the native delete_branch_on_merge setting that handles merged PRs. Host-agnostic: no Vercel, Neon or any external service required, works in any GitHub repo. Never deletes a branch that open PRs target as their BASE (that would CLOSE those PRs and destroy a stack). Use when asked to clean up / delete stale, merged, abandoned or orphaned branches, stop branches piling up, auto-delete branches after merge, enable delete_branch_on_merge across an org, add a branch retention or sweep workflow, or safely prune branches in a repo that uses stacked PRs (Graphite / ghstack / spr)."
metadata:
  author: stealth-engine
  co-author: wiiiimm
  version: "1.0.0"
---

# Branch cleanup

Authors GitHub Actions workflows that delete stale branches. **This skill installs
workflows; it never deletes anything itself.** At runtime there is no agent and no model
call — deterministic bash + `gh` only.

Verified GitHub behaviour (the `delete` event, ruleset errors, `gh` footguns, base-branch
semantics) lives in [`reference/github-facts.md`](./reference/github-facts.md). Read it
before changing any deletion logic.

## The one rule that must never be relaxed

**Before deleting ANY branch, check for open PRs that target it as base:**

```bash
gh pr list --base <branch> --state open --json number --limit 1000
```

GitHub documents it plainly: *"If the branch is associated with at least one open pull
request, deleting the branch closes the pull requests."* That is often **unrecoverable** —
you cannot retarget a closed PR, nor reopen it while its base is missing.

Two traps that make this worse than it looks:

- **`gh pr list --limit` defaults to 30.** A stack deeper than 30 silently under-reports
  and the guard passes when it shouldn't. Always pass an explicit high limit.
- **Auto-retargeting will not save you.** It only applies to a *head* branch whose PR is
  *already merged*, and it appears to live in the **web** deletion path — community
  reports (one confirmed by GitHub staff as a bug) say deleting a ref via API or
  `git push --delete` **closes** dependent PRs instead. A bot must assume the close path.

This check runs on **every** deletion path, sweep included — and it **fails closed**: if
the API call errors (a plausible rate-limit mid-sweep, since it runs once per branch), the
branch is skipped rather than assumed safe.

It is also not the only head-side guard: a branch with *any* open PR from it as head is
skipped too, so a second open PR from the same head can't be destroyed by a stale
`closed` event for a different one.

## What handles what

| Path | Handled by | Why |
| --- | --- | --- |
| PR **merged** | the repo's native `delete_branch_on_merge` setting | more reliable than an Action racing it — **do not** duplicate this in a workflow |
| PR **closed unmerged** | `pull_request: closed` + `merged == false` workflow | the native setting only fires on merge |
| Branch that **never had a PR**, or was skipped by a guard | scheduled orphan sweep | the backstop; **not optional** |

### Prerequisite: enable `delete_branch_on_merge`

```bash
gh api repos/{owner}/{repo} --jq .delete_branch_on_merge          # check
gh api -X PATCH repos/{owner}/{repo} -F delete_branch_on_merge=true   # enable
```

Use `-F`, not `-f` — `-f` sends the string `"true"`. Two facts worth surfacing:

- **There is no org-level default.** `PATCH /orgs/{org}` has no such property, so it must
  be set per repo. [`scripts/enable-auto-delete-org.sh`](./scripts/enable-auto-delete-org.sh)
  does it in bulk (dry-run by default, paginates past 100 repos, skips archived/forks and
  repos where you lack admin).
- **It CAN be set at repo creation** via `POST /user/repos` and `POST /orgs/{org}/repos`
  (org endpoint needs an org owner to set `true`) — but **not** via the
  template-generate endpoint, so template-created repos need a follow-up PATCH.

## Stacked PRs

Beyond the base-PR guard:

- **Grace period (`grace_minutes`).** Stack tooling force-pushes and sometimes **closes
  and reopens** PRs during a restack, so a `closed` event is *not* proof of abandonment.
  This is an **age filter, never a sleep**: inside the window the event path defers to the
  sweep, which re-checks live state when it runs. Sleeping in the job would bill Actions
  minutes for every closed PR to do nothing. Cost: cleanup latency becomes
  `grace_minutes + sweep interval`. **Default 0** — no stack tooling was found in these
  repos; set it to ~10 if you adopt Graphite/ghstack/spr.
- **Live re-query, always on.** The webhook payload is a snapshot and the run may have
  queued, so PR state is re-read at delete time even at `grace_minutes: 0`.
- **`excluded_patterns`** for stack-tool scratch refs (`gt/*`, `spr/*`).
- Stacks merge bottom-up in **bursts**; the sweep paces itself between deletions.

## Other guards

- **Never deleted:** `main`, `master`, `develop`, `dev`, `staging`, `production`,
  `release/*`, `hotfix/*`, and the repo's actual default branch. Configurable.
- **Fork PRs skipped** — the head branch isn't ours to delete.
- **Already-deleted is success.** The API returns 422 `Reference does not exist`, not 404.
- **Ruleset-blocked deletions are reported distinctly** (422 + `Cannot delete this
  protected ref`) — those need a human, not a retry. Detection keys off the *message*,
  because 422 is overloaded. A `gh ruleset check` pre-flight is **not** a reliable
  predictor: it reports configured rules and ignores the caller's bypass.
- **Sweep is report-only by default** — it lists what it would delete; deleting requires
  `sweep_delete: true`.

## Known failure mode

**Merge queues can stop the native auto-delete from firing** even when enabled, and
`gh pr merge --delete-branch` on a queue-enabled repo has been reported to delete the
branch *before* merge, closing the PR and evicting it from the queue. Neither is
officially documented. The scheduled sweep is what covers the first case.

## Rolling out across many repos

- **Pin the reusable workflow to a tag or SHA, not `@main`** — it holds `contents: write`.
- **Substitute your own org** for `stealth-engine` in the caller's `uses:`.
- Start with `sweep_delete: false` (the default) and read a few reports before enabling
  deletion — the sweep is the path that touches branches nobody explicitly closed.

## Install

1. Host [`templates/reusable-branch-cleanup.yml`](./templates/reusable-branch-cleanup.yml)
   **once** in the org's `.github` repo. Do not copy it per repo.
2. Add [`templates/caller-branch-cleanup.yml`](./templates/caller-branch-cleanup.yml) to
   each repo (~30 lines).
3. Enable `delete_branch_on_merge` (above).
4. **Private repos:** on the *hosting* repo set **Settings → Actions → General → Access**
   to "Accessible from repositories in the organization", or every caller fails.
5. For new repos, add a `workflow-templates/` entry in the org `.github` repo. A **public**
   `.github` repo is no longer required (changed 2025-09-18) — an *internal* one serves
   internal + private repos.
6. Test with `workflow_dispatch` and `dry_run: true` first.

Installation is idempotent: detect an existing workflow, diff it, offer an upgrade — never
clobber local edits without showing them first. Validate generated YAML (`actionlint` if
available, else a YAML parse) before writing.

## See also

- [`vercel-preview-cleanup`](../vercel-preview-cleanup/SKILL.md) — the **downstream**
  companion: deleting a branch is what triggers preview-deployment cleanup. Install this
  skill first; without branch deletion its `delete` event rarely fires.
- Neon's Vercel integration reaps preview **database** branches once the git branch is
  gone — no code needed, another reason timely deletion matters.
