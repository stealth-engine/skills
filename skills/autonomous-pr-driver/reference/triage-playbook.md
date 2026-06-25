# Triage playbook

Decision rules and command recipes for the resolve-reviews loop. Read this when you
need the exact `gh` calls or the finer judgment rules; the lifecycle overview is in
[`../SKILL.md`](../SKILL.md).

## Fetch the review surface

```bash
PR=123 ; REPO=owner/name

# Review bodies (top-level summaries) — state + which commit they reviewed.
gh api repos/$REPO/pulls/$PR/reviews --jq \
  '.[] | "\(.user.login) [\(.state)] \(.commit_id[0:7]) \(.submitted_at)"'

# Inline comments — path, line, the commit they're anchored to, and (if present)
# the stable finding id. Filter to the LATEST commit to see "this round".
gh api repos/$REPO/pulls/$PR/comments --paginate --jq \
  '.[] | "\(.user.login) | \(.path):\(.line // .original_line) | \(.commit_id[0:7]) | "
   + (.body|capture("BUGBOT_BUG_ID: (?<id>[a-f0-9-]+)")?.id // "n/a")'

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
for i in $(seq 1 50); do
  out=$(gh pr checks $PR --repo $REPO 2>/dev/null)
  pending=$(printf '%s\n' "$out" | grep -i 'pending' | grep -vci 'Approval Agent')
  [ "${pending:-0}" -eq 0 ] && { echo "settled"; printf '%s\n' "$out"; break; }
  sleep 20
done
```

Tune the `grep -vci` exclusion to whatever human-gated/neutral checks your repo has
(e.g. an approval agent that only passes on human review, or a bot that reports
`skipping`). Those must not keep the loop spinning forever.

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
- **Version / "X is unpublished" claims** → `gh api repos/<owner>/<repo>/releases/latest --jq .tag_name`.
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
- If `gh pr create`/`gh pr comment` 401s on GraphQL but `gh api` reads work, the
  token is read-restricted — fall back to `gh api ... -X POST .../pulls` or surface a
  compare URL and ask the human to refresh `gh auth`.

## Auth & transport gotchas

- Git **push** over SSH can succeed while the **`gh` API token** is invalid — check
  `gh auth status` if API writes fail but pushes don't.
- A release/commit made with the built-in `GITHUB_TOKEN` won't trigger downstream
  `on:` workflows; a PAT/bot token does. Relevant when a deploy/check only fires on a
  bot action.

## Convergence — the honest definition

All **required** checks green **and** the latest round surfaced **no new valid
findings**. Non-deterministic LLM reviewers will keep emitting marginal/duplicate
comments forever; "zero open comments" is not the bar. Document rejected/stale items,
then hand off.
