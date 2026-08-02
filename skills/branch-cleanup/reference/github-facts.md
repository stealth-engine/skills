# Verified GitHub facts behind this skill

**Verified 2026-08-01** against docs.github.com, GitHub's OpenAPI spec, and live API
probes. Legend: **[D]** docs · **[S]** OpenAPI spec · **[E]** empirically verified ·
**[C]** community-captured, not official · **[U]** unverified.

## 1. Deleting a base branch CLOSES dependent PRs — the reason for the guard

> "If the branch is associated with **at least one open pull request, deleting the branch
> closes the pull requests**." **[D]**

"Associated with" is role-agnostic — it covers base *and* head. This is why
`gh pr list --base <branch> --state open` is checked before **every** deletion.

**Retargeting is a narrow carve-out with two preconditions** — the branch must be a
**head** branch *and* its PR must already be **merged**: **[D]**

> "If you delete a head branch **after its pull request has been merged**, GitHub checks
> for any open pull requests… that specify the deleted branch as their base branch.
> GitHub automatically updates any such pull requests, changing their base branch to the
> merged pull request's base branch."

⚠️ **Retargeting appears to be implemented in the web deletion path, not the ref layer.**
Community reports say `git push origin --delete` **closes** dependent PRs rather than
retargeting them (discussion #131045, unresolved); the same was reported for the mobile
app and **confirmed by GitHub staff as a bug** (#127281). **[C]** A cleanup bot deleting
refs via API or git must assume the **close** path even for merged branches.

**Deletion is not blocked at the API layer.** The PR page hides the delete button while a
PR is open, and the branches list shows a warning dialog — but `DELETE /git/refs` has
**no block and no documented mention of PRs at all**. The guard is entirely ours. **[D]** **[S]**

Recovery is **[U]** — docs don't cover reopening a PR closed by base deletion, and you
can't retarget a closed PR or reopen it while its base is missing. Treat this as
unrecoverable and never risk it.

## 2. `on: delete`

| Fact | Value |
| --- | --- |
| Fires for | branches **and tags** — gate on `github.event.ref_type == 'branch'` **[D]** |
| `github.event.ref` | **bare name**, no `refs/heads/` prefix; slashes preserved **[E]** |
| Filters | **none** — no `branches:`/`tags:` filter, no activity types. Filter in `if:` **[D]** |
| Workflow location | must exist on the **default branch** or it never runs **[D]** |
| `github.ref` | resolves to the **default branch** — useless for identifying the deleted ref **[D]** |

**The three-tag cap is TAG-ONLY.** Every instance of "an event will not be created when
you delete more than three tags at once" is explicitly scoped to tags, in both the Actions
and webhooks references. **No branch equivalent is documented anywhere.** **[D]** Whether
an undocumented internal cap exists is **[U]** — don't design around one, don't promise
its absence. The scheduled sweep is the backstop either way.

## 3. `delete_branch_on_merge`

```bash
gh api repos/{owner}/{repo} --jq .delete_branch_on_merge          # read
gh api -X PATCH repos/{owner}/{repo} -F delete_branch_on_merge=true   # set
```

`-F` performs type conversion (→ JSON `true`). `-f` would send the **string** `"true"`.

> ⚠️ **Correction to a common assumption:** it **CAN** be set at repo creation —
> `POST /user/repos` and `POST /orgs/{org}/repos` both accept it **[S]** (the org endpoint
> requires an **organization owner** to set it `true`). Only
> `POST /repos/{owner}/{repo}/generate` (template-generated repos) omits it and needs a
> follow-up PATCH.

**Org-level default: confirmed none.** `PATCH /orgs/{org}` has zero branch/merge/delete
properties **[S]** **[E]**, so a fleet-wide rollout must iterate per repo.

**Merge queues** **[U]** — no official docs. Community reports (a) head branches sometimes
never auto-deleted with a queue enabled, and (b) `gh pr merge --delete-branch` on a
queue-enabled repo deleting the branch *before* merge, closing the PR and evicting it from
the queue (cli/cli#7011). Real risks, unconfirmed by GitHub. The scheduled sweep covers (a).

## 4. Blocked deletions — detect by message, not status code

`DELETE /repos/{owner}/{repo}/git/refs/{ref}` documents only **204 / 422 / 409** — no
403/404 **[S]**. 422 is heavily overloaded, so branch on the `message`:

| Cause | Status | `message` |
| --- | --- | --- |
| Ruleset `deletion` rule | 422 | `Repository rule violations found\n\nCannot delete this protected ref.` **[C]** |
| Already deleted | 422 | `Reference does not exist` (**not** 404) **[C]** |
| Token lacks permission | 403 | `Resource not accessible by integration` **[C]** |
| Classic branch protection | ? | **[U]** — no capture found. Do not assume 422. |

`documentation_url` is always the endpoint's URL — never key detection off it.

**Pre-check exists but is not a predictor:** `GET /repos/{o}/{r}/rules/branches/{branch}`
(or `gh ruleset check <branch>`) returns *configured* rules — **[E]** it returned the
`deletion` rule for `main` even though the caller was `exempt` on that ruleset. Presence of
a `deletion` rule does **not** mean the delete will fail. Classic branch protection never
appears here at all — check `branch.protected` separately.

## 5. Reusable workflows across an org

Setting is **Access**, on the **HOST** repo (not the caller): *Settings → Actions →
General → Access* → "Accessible from repositories in the ORG organization". **[D]**
Without it every caller in a private repo fails.

Visibility: internal-repo workflows can't be used by public repos; private-repo workflows
can't be used by public or internal repos. **[D]**

Limits **[D]**: max **10 levels** of nesting; `secrets: inherit` works within the same
org/enterprise; secrets pass **one hop only** (A→B→C needs explicit passing at each hop);
environment secrets can't be passed (`on.workflow_call` has no `environment`); permissions
can only be **maintained or reduced**, never elevated; no expressions in `uses:`.

## 6. `workflow-templates/`

`workflow-templates/` at the root of the org's `.github` repo, with matching
`<name>.yml` + `<name>.properties.json` (`name` and `description` required). **[D]**

> ⚠️ **A public `.github` repo is no longer required — changed 2025-09-18.** **[D]**
> "Workflow templates in a public `.github` repository are available to all repository
> types. Workflow templates in an **internal** `.github` repository are only available to
> internal and private repositories. Workflow templates in a **private** `.github`
> repository are only available to private repositories."

## 7. `gh` CLI specifics

```bash
# open PRs targeting a branch as BASE — the safety check
gh pr list --base <branch> --state open --json number,headRefName --limit 1000
```

⚠️ **`--limit` defaults to 30.** A stack deeper than 30 would silently under-report and
the guard would pass when it shouldn't. Always pass an explicit high `--limit`. **[D]**
`gh pr list` paginates internally up to `--limit`; no `--paginate` needed.

**There is no `gh branch` command** **[E]** — delete a ref with:

```bash
gh api -X DELETE repos/{owner}/{repo}/git/refs/heads/<branch>   # → 204  [E]
```

Slashed names work as-is (`heads/feat/foo`). For REST list endpoints past 100 results use
`gh api ... --paginate` (`per_page` max 100).

Branch + associated-PR state in one call needs GraphQL (`refs` →
`associatedPullRequests`), which returns PRs where the branch is the **head** — pair it
with `gh pr list --base` for base-role detection.

## 8. `Ref.associatedPullRequests` is keyed on the ref NAME, not the tip commit

Two same-named fields with **different** semantics — using the wrong mental model leads
to real bugs in a cleanup guard: **[S]**

| Field | Schema description |
| --- | --- |
| `Ref.associatedPullRequests` | "A list of pull requests with this **ref as the head ref**." |
| `Commit.associatedPullRequests` | "The merged Pull Request that **introduced the commit**…" |

Only `Commit.*` is commit-derived. **[E] Verified** by force-pushing a ref onto a commit
that was never part of its PR — the association survived unchanged:

```text
tip=d2e8c85 (the PR's own commit)      prs=[{"number":28,"state":"CLOSED"}]
tip=2879cb5 (never part of PR #28)     prs=[{"number":28,"state":"CLOSED"}]
```

So a force-push **cannot** orphan a branch's PR history and silently route it down a
"never had a PR" code path. Any guard reasoning that assumes it can is unfounded —
but note the no-PR path still needs its own ref-activity check, because a branch that
genuinely never had a PR can be **recreated today at an ancient commit**, where
`committedDate` alone would age it as stale.
