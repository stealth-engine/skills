# Triage playbook

Decision rules and command recipes for the resolve-reviews loop. Read this when you
need the exact `gh` calls or the finer judgment rules; the lifecycle overview is in
[`../SKILL.md`](../SKILL.md).

## Fetch the review surface

```bash
PR=123 ; REPO=owner/name
# HEAD = the commit this round is about. Filter BOTH reviews and comments to it so
# stale findings from older commits don't leak into triage. (gojq reads env.HEAD.)
export HEAD=$(gh pr view $PR --repo $REPO --json headRefOid --jq .headRefOid)

# Review bodies (top-level summaries) for THIS round — state + who.
gh api repos/$REPO/pulls/$PR/reviews --jq \
  '.[] | select(.commit_id == env.HEAD) | "\(.user.login) [\(.state)] \(.submitted_at)"'

# Inline comments on THIS round (HEAD), with the stable finding id.
gh api repos/$REPO/pulls/$PR/comments --paginate --jq \
  '.[] | select(.commit_id == env.HEAD)
       | "\(.user.login) | \(.path):\(.line // .original_line) | "
       + ( (.body|capture("BUGBOT_BUG_ID: (?<id>[a-f0-9-]+)")?|.id)      # Cursor
         // (.body|capture("cr-comment:v1:(?<id>[A-Za-z0-9]+)")?|.id)    # CodeRabbit
         // "n/a" )'

# Top-level (issue) comments — bots post summaries/replies here too.
gh api repos/$REPO/issues/$PR/comments --paginate --jq '.[] | "\(.user.login) \(.created_at)"'

# Check rollup + mergeability.
gh pr checks $PR --repo $REPO
gh pr view  $PR --repo $REPO --json mergeable,mergeStateStatus,state,reviewDecision
```

> Big comment bodies can exceed tool output limits — pipe through `jq` slices
> (`.body[0:400]`) or strip HTML `<details>` blocks before reading.

## Poll until checks settle

Don't triage mid-run. Treat as settled when nothing is pending **except** a
human-gated approver. Run this in the background and act when it returns:

```bash
settled=0
for i in $(seq 1 50); do
  # Structured output (don't grep text); FAIL CLOSED — an errored/empty result is
  # treated as "not settled" so a transient gh/network failure can't look settled.
  # gh pr checks exits non-zero while checks are pending/failing but STILL prints the
  # JSON — so `|| true` keeps the captured stdout (don't clobber it to ""). Only a
  # genuinely empty result (a real gh/network failure) is treated as "not settled".
  checks=$(gh pr checks $PR --repo $REPO --json name,bucket 2>/dev/null) || true
  if [ -n "$checks" ]; then
    total=$(printf '%s' "$checks" | jq 'length')
    # Count checks still pending, excluding human-gated approvers (tune the pattern).
    blocking=$(printf '%s' "$checks" |
      jq '[.[] | select(.bucket=="pending" and (.name|test("Approval Agent")|not))] | length')
    # Require ≥1 registered check AND none pending. An empty [] means CI hasn't
    # registered any checks yet (gh exit 16) — that's NOT settled, keep polling.
    if [ "${total:-0}" -gt 0 ] && [ "${blocking:-1}" -eq 0 ]; then
      echo "settled"; gh pr checks $PR --repo $REPO; settled=1; break
    fi
  fi
  sleep 20
done
# Don't treat "ran out of budget" as success — surface the timeout so the loop can
# decide (a check may be stuck/queued; investigate rather than triage blindly).
[ "$settled" -eq 1 ] || { echo "TIMED OUT — checks never settled"; exit 1; }
```

`bucket` is one of `pass | fail | pending | skipping | cancel`. "Settled" = nothing
**pending** (failed checks *have* finished — you triage those next). Tune the
`test("Approval Agent")` exclusion to whatever human-gated checks your repo has (an
approver that only passes on human review) so they don't spin the loop forever.

## Dedup by finding ID, never by line number

Bots re-anchor the **same** finding to new line numbers on every push, so matching
on `path:line` makes everything look "new." Match on the stable id instead:

- **Cursor Bugbot:** `BUGBOT_BUG_ID: <uuid>` in the comment body.
- **CodeRabbit:** `cr-comment:v1:<hash>` and `fingerprint:` markers.
- Others: hash the (rule + file) or the first sentence of the body.

Keep a set of seen/resolved ids across rounds. A finding whose id you've already
resolved is **stale** — but still **verify it's fixed in the current file** (grep the
code) before skipping, in case a later commit regressed it.

## Verify-before-trust

Confirm a claim with a real check rather than trusting the bot *or* your own first
read. Cheap verifications that repeatedly paid off:

- **Shell/regex claims** → write the snippet to a file and run it (inline shell tests
  get mangled by quoting): `printf '%s' "$msg" | grep -E '<pattern>'`, or a tiny
  `bash test.sh`.
- **Code logic** → a 5-line `node`/`python` harness exercising the edge cases.
- **Version / "X is unpublished" claims** → check the tag exists:
  `gh api repos/<owner>/<repo>/git/ref/tags/<tag>` (404 = doesn't exist). Prefer this
  over `releases/latest`, which 404s for repos that tag without publishing a Release
  (common for GitHub Actions).
- **"Does the tool actually do Y"** → check the upstream docs/source, not memory.

If verification contradicts the bot → it's an **invalid** finding (reject). If it
contradicts *you* → fix it.

## Reject criteria

Reject (don't fix) when the finding is:

1. **Factually wrong / hallucinated** (verification disproves it).
2. **Against a documented house rule** (`AGENTS.md`, `CONTRIBUTING`) — cite the rule.
3. **An opinion, not a defect** — style/consistency preference with no correctness
   impact, especially if it conflicts with the repo's conventions.
4. **A suggested fix that's worse** than the current code (e.g. would re-introduce a
   security issue, or override deliberate author intent).
5. **Contradicted by another reviewer** — see below.

## Adjudicating conflicting bots

When two reviewers demand opposite things, pick on **correctness/safety**, not
consensus, and write the reasoning in the reject comment. Worked example: one bot
wanted fork-PR titles validated case-*insensitively* (consistency with the
auto-fixing same-repo path); another wanted them kept **strict**. Strict won —
a fork title can't be auto-corrected and a mis-cased `Feat:` doesn't match
semantic-release's release rules, so lenient would silently under-release.

## Posting comments / @-mentions

```bash
# A standalone PR comment (rejections, status summaries, @-mention nudges).
gh pr comment $PR --repo $REPO --body "$(cat <<'EOF'
Rejecting <finding>: <one-line reason>. @coderabbitai — resolved on HEAD, please re-scan.
EOF
)"
```

- `@coderabbitai` re-scans and records Learnings → tag it when rejecting.
- Don't tag bots that have re-posted resolved findings repeatedly (see
  [`known-bots.md`](./known-bots.md)) — it's noise.
- If a `gh` write 401s but `gh api` reads work, the token is read-restricted/expired
  (`gh pr create`/`gh pr comment` use GraphQL). REST fallbacks:
  - **open a PR:** `gh api repos/$REPO/pulls -X POST -f title=… -f head=… -f base=… -f body=…`
  - **post a comment:** `gh api repos/$REPO/issues/$PR/comments -X POST -f body=…`
  - If REST also 401s, the token itself is bad → ask the human to `gh auth login`
    (or, for opening a PR, surface a compare URL they can click).

## Auth & transport gotchas

- Git **push** over SSH can succeed while the **`gh` API token** is invalid — check
  `gh auth status` if API writes fail but pushes don't.
- A release/commit made with the built-in `GITHUB_TOKEN` won't trigger downstream
  `push` / `pull_request` / `release` `on:` workflows (a PAT/bot token does) —
  relevant when a deploy/check only fires on a bot action. *(Exception:
  `workflow_dispatch` / `repository_dispatch` can still be fired with `GITHUB_TOKEN`.)*

## Convergence — the honest definition

All **required** checks green **and** the latest round surfaced **no new valid
findings**. Non-deterministic LLM reviewers will keep emitting marginal/duplicate
comments forever; "zero open comments" is not the bar. Document rejected/stale items,
then hand off.
