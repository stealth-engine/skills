# Triage playbook

Decision rules and command recipes for the resolve-reviews loop. Read this when you
need the exact `gh` calls or the finer judgment rules; the lifecycle overview is in
[`../SKILL.md`](../SKILL.md).

## Fetch the review surface

```bash
PR=123 ; REPO=owner/name
export HEAD=$(gh pr view $PR --repo $REPO --json headRefOid --jq .headRefOid)

# (a) Which reviewers have reported on THE CURRENT HEAD? (a convergence gate — work on
# an older commit doesn't count.) Count BOTH submitted reviews AND inline review
# comments anchored to HEAD: some bots leave only inline comments, no review record, so
# reviews alone would never register them. --paginate walks all pages (reviews come
# oldest-first, so HEAD's are on the LAST page). (jq/gojq read env.HEAD — export it.)
# CAVEAT: GitHub bumps a non-outdated inline comment's commit_id forward to the new head
# on each push, so this can count a reviewer who last commented on an EARLIER push as
# "on HEAD" — don't treat it as sufficient alone. Pair with the bot's check completing
# on HEAD (convergence gate 1) before accepting a reviewer as having weighed in.
# CAPTURE EACH LOOKUP SEPARATELY, don't pipe a brace group into `sort -u`. A pipeline
# takes the status of its LAST command, so `{ failing-gh; gh; } | sort -u` exits 0 and a
# failed lookup arrives as an EMPTY reviewer set — read as "nobody has reviewed HEAD",
# which is the fail-open this file forbids ("a failed lookup is missing evidence, never
# silence"). `set -o pipefail` would also work but isn't POSIX; this is portable.
rvw=$(gh api "repos/$REPO/pulls/$PR/reviews"  --paginate --jq '.[]|select(.commit_id==env.HEAD)|.user.login') \
  || { echo "reviews lookup FAILED — missing evidence, not silence" >&2; exit 1; }
cmt=$(gh api "repos/$REPO/pulls/$PR/comments" --paginate --jq '.[]|select(.commit_id==env.HEAD)|.user.login') \
  || { echo "review-comments lookup FAILED — missing evidence, not silence" >&2; exit 1; }
printf '%s\n%s\n' "$rvw" "$cmt" | sort -u   # reviewers that have weighed in on HEAD

# (b) OPEN FINDINGS = every UNRESOLVED review thread — regardless of which commit it
# was anchored to or when it was posted. THIS is the source of truth for "what's left
# to triage", NOT a commit/time-filtered comment list. `isOutdated` = the thread's
# code changed (a HINT it may be stale — still verify in the file, don't auto-skip).
# --paginate + pageInfo/$endCursor walks ALL pages — `first:100` alone silently drops
# threads past page 1 (the same drop-bug this recipe exists to avoid). Output carries
# the stable id (from the comment body, for Dedup) and falls back line→originalLine for
# outdated/re-anchored threads.
gh api graphql --paginate -f query='
  query($owner:String!,$repo:String!,$pr:Int!,$endCursor:String){
    repository(owner:$owner,name:$repo){ pullRequest(number:$pr){
      reviewThreads(first:100, after:$endCursor){
        pageInfo{ hasNextPage endCursor }
        nodes{ isResolved isOutdated path line originalLine
          comments(first:1){ nodes{ author{login} body url } } } } } } }' \
  -f owner=${REPO%/*} -f repo=${REPO#*/} -F pr=$PR \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved==false)
        | "\(.comments.nodes[0].author.login) | \(.path):\(.line // .originalLine // "file") | outdated=\(.isOutdated) | "
          + ( (.comments.nodes[0].body|capture("BUGBOT_BUG_ID: (?<id>[a-f0-9-]+)")?|.id)    # Cursor
            // (.comments.nodes[0].body|capture("cr-comment:v1:(?<id>[A-Za-z0-9]+)")?|.id)  # CodeRabbit
            // (.path + "#" + (.comments.nodes[0].body|ltrimstr("\n")|split("\n")[0])[0:80]) )'  # stable fallback (no marker): file + first line, so unmarked comments don't look new each pass

# (c) Top-level (issue) comments — some bots post findings/summaries here; these have
# NO thread/resolve state, so dedup them by stable id (next section), not by time.
# FILTER OUT non-findings so they don't re-enter triage forever: your OWN rejection/
# status replies (set ME to the account this loop posts as) and bot summary/linkback
# comments (no actionable finding). Emit id (or first-line fallback) + body preview.
export ME=your-bot-or-username   # <-- the login this loop comments as; skip its own posts
# NOISE is a repo-specific regex of non-finding boilerplate to drop (bot summaries,
# linkbacks). The values below are EXAMPLES from one repo's tooling — replace them with
# your repo's own noise markers (or set to a pattern that never matches to disable). # <-- tune this
export NOISE='linear-linkback|auto-generated comment: summarize'
gh api repos/$REPO/issues/$PR/comments --paginate --jq \
  '.[] | select(.user.login != env.ME)
       | select(.body | test(env.NOISE; "i") | not)
       | "\(.user.login) | "
       + ( (.body|capture("BUGBOT_BUG_ID: (?<id>[a-f0-9-]+)")?|.id)
         // (.body|capture("cr-comment:v1:(?<id>[A-Za-z0-9]+)")?|.id)
         // (.body|ltrimstr("\n")|split("\n")[0])[0:80] )
       + " | " + (.body[0:200])'

# (d) Check rollup + mergeability.
gh pr checks $PR --repo $REPO
gh pr view  $PR --repo $REPO --json mergeable,mergeStateStatus,state,reviewDecision
```

> **Never scope OPEN findings by timestamp or by `commit_id == HEAD`.** Both silently
> drop a finding anchored to an *earlier* commit (or posted just before your poll
> window) whose thread is still **unresolved** — the exact way a real review gets
> missed and the PR is called green with an open issue. Enumerate **all unresolved
> threads** (query b); decide stale-vs-valid by **stable id + verifying the current
> file**, never by when or which commit the comment sits on.

> Big comment bodies can exceed tool output limits — pipe through `jq` slices
> (`.body[0:400]`) or strip HTML `<details>` blocks before reading.

## Wait until checks settle

Don't triage mid-run. Treat as settled when nothing is pending **except** a
human-gated approver.

**Try the blocking waits first — this poll loop is rung 3 of the ladder in `SKILL.md`,
not the default.**

```bash
# Rung 2 — portable, no harness support needed. Blocks until checks finish.
#
# (a) RESOLVE THE PR HEAD — not the local checkout. The driver frequently attaches to a
#     PR while checked out on another branch; `git rev-parse HEAD` would probe the wrong
#     commit, and a local commit that happens to have checks waves you straight through.
SHA=$(gh pr view "$PR" --repo "$REPO" --json headRefOid --jq .headRefOid)
[ -n "$SHA" ] || { echo "could not resolve PR head" >&2; exit 1; }
# (b) GIVE SLOW WORKFLOWS TIME TO REGISTER. Straight after a push, `gh pr checks` reports
#     "no checks reported" and EXITS rather than waiting — a false "settled" while CI is
#     starting. Worse, "at least one check exists" is not proof they all do: measured on
#     this repo a skipped check registered at 08:18:01 while the last reviewer status
#     appeared at 08:18:53, a 52s spread, so firing on the first arrival lets --watch
#     return having only ever seen the quick one.
#     A flat wait is deliberate. Earlier revisions of this snippet counted checks and
#     tested for stability; that logic drew a defect in four consecutive review rounds
#     while protecting against something whose remedy is simply "wait longer". If you
#     need determinism, assert your own required check names before watching instead.
GRACE=${GRACE:-90}
case "$GRACE" in ''|*[!0-9]*) echo "GRACE must be a non-negative integer" >&2; exit 1 ;; esac
# Without `set -e` (deliberately not set — see below), a failed `sleep` would fall
# straight through to --watch with NO registration delay, silently losing the guard.
sleep "$GRACE" || { echo "sleep failed — no registration delay, failing closed" >&2; exit 1; }
# (c) NO --fail-fast: it means "exit watch mode on first check FAILURE", so one early red
#     returns while everything else is still pending — triaging mid-run, which this
#     section forbids. You want every result, including the slow ones.
# (d) A DEADLINE IS MANDATORY, and `timeout` is GNU coreutils — ABSENT on stock
#     macOS/BSD. Do NOT silently degrade to an unbounded --watch: with a pending human
#     gate (below) that hangs forever, which is worse than not using this rung at all.
TO=""
command -v timeout  >/dev/null 2>&1 && TO="timeout 1800"
[ -z "$TO" ] && command -v gtimeout >/dev/null 2>&1 && TO="gtimeout 1800"
if [ -z "$TO" ]; then
  echo "no timeout/gtimeout — use rung 3, not an unbounded --watch" >&2; exit 1
fi
# (e) CAPTURE the status — do not leave this call unguarded. `gh pr checks` exits
#     NONZERO for settled-but-red (1) and for pending (8), so under a `set -e` driver an
#     unguarded call ABORTS THE RUN on exactly the outcome you were waiting to triage.
#     (The rung-3 comment below already documents these codes; rung 2 has to honour them.)
#     Capture it WITHOUT touching the caller's shell: `set -e` is suppressed inside an
#     if-condition, so no set +e/set -e dance is needed — and an unconditional `set -e`
#     would switch errexit ON for a caller that never asked for it (this recipe gets
#     pasted into interactive shells), where a later no-match `grep` then kills it.
if $TO gh pr checks "$PR" --repo "$REPO" --watch; then rc=0; else rc=$?; fi
case "$rc" in
  0)   : ;;   # settled, all green
  1)   # AMBIGUOUS — gh returns 1 for a failing check AND for ordinary command errors.
       # Verified: a nonexistent PR, an unknown repo and a bad flag ALL exit 1, so
       # accepting 1 blindly treats an API error (or "no checks reported") as a finished
       # red build and walks straight into triage. Confirm against the rollup first.
       # Capture each half INDEPENDENTLY. A brace group takes the exit status of its LAST
       # command, so if check-runs 403s or times out while statuses succeeds, `all` is
       # non-empty from statuses alone and every pending check-run is invisible to the
       # test below — half a rollup reading as a whole one.
       # ALLOWLIST the terminal state; do not enumerate the pending ones. A check run's
       # status can be queued/in_progress/waiting/requested/pending — enumerating that
       # set means every value GitHub adds later silently reads as "settled". Only
       # `completed` is done; a commit status is done unless it is `pending`.
       if cr=$(gh api "repos/$REPO/commits/$SHA/check-runs" --paginate \
                 --jq '.check_runs[] | if .status == "completed" then "done" else "PENDING" end' \
                 2>/dev/null); then cr_ok=1; else cr_ok=0; fi
       if st=$(gh api "repos/$REPO/commits/$SHA/status" --paginate \
                 --jq '.statuses[] | if .state == "pending" then "PENDING" else "done" end' \
                 2>/dev/null); then st_ok=1; else st_ok=0; fi
       if [ "$cr_ok" != 1 ] || [ "$st_ok" != 1 ]; then
         echo "rc=1 but a rollup query failed — cannot confirm settlement; failing closed" >&2; exit 1
       fi
       all=$(printf '%s\n%s\n' "$cr" "$st")
       if [ -z "$(printf '%s' "$all" | tr -d '[:space:]')" ]; then
         echo "rc=1 and the rollup is empty/unreadable — command error, not a red build; failing closed" >&2; exit 1
       fi
       if printf '%s\n' "$all" | grep -q '^PENDING$'; then
         echo "rc=1 but checks are still pending — not settled; failing closed" >&2; exit 1
       fi
       ;;   # confirmed: checks exist, all finished, some red → triage
  8)   echo "still pending after watch — NOT settled (failing closed)" >&2; exit 1 ;;
  124) echo "watch hit the deadline — NOT settled (failing closed)" >&2; exit 1 ;;
  *)   echo "gh pr checks errored (rc=$rc) — failing closed" >&2; exit 1 ;;
esac
# (f) THE HEAD CAN MOVE WHILE YOU WAIT. Everything downstream — reviewer-reported-on-HEAD,
#     open findings, the status table — must describe ONE commit. If someone pushed during
#     the wait, the checks you just watched belong to the old head while your evidence
#     queries would read the new one. Re-validate and restart rather than mix the two.
NOW=$(gh pr view "$PR" --repo "$REPO" --json headRefOid --jq .headRefOid) || NOW=""
if [ -z "$NOW" ] || [ "$NOW" != "$SHA" ]; then
  echo "head moved ${SHA:0:7} -> ${NOW:-?} during the wait — restart, do not triage" >&2; exit 1
fi
```

`--watch` blocks until checks finish, re-querying every 10s (`-i` to change). It works
anywhere there's a shell and network — Cursor, Replit, Codespaces, CI, a laptop. Run it
in the background and act on completion. (Verified: on a settled PR it returns
immediately, exit 0.)

**What it saves is *your turns*, not API calls.** `--watch` is **client-side polling**,
not a server-side subscription: `gh` sleeps for the interval and re-queries in a loop
(verified in `cli/cli` `pkg/cmd/pr/checks/checks.go` — `time.Sleep(opts.Interval)` then
`populateStatusChecks`; the manual calls `-i` a "Refresh interval ... in watch mode").
So at the default 10s a 30-minute deadline is ~180 GraphQL queries — *more* API traffic
than rung 3's 30s loop, not less. The win is that all of it happens inside **one** shell
invocation, so an agent spends one turn instead of N. Budget rate limit accordingly, and
raise `-i` on a long build.

**Its last column is the check's description — read it.** This is where the
green-but-never-reviewed case is visible:

```text
CodeQL       pass  2s   https://…
CodeRabbit   pass  0         Review rate limited     ← green, and NOT reviewed
```

**⛔ The human-gate trap — check this before choosing rung 2.** `--watch` waits for
**every** check to finish, and a human-gated approver (e.g. Cursor Approval Agent) stays
`pending` until a person acts. This section defines settled as *"nothing pending except
human gates"*, so on those repos `--watch` blocks on exactly the check you're meant to
ignore — indefinitely, until the `timeout` fires.

Verified: `gh pr checks` has **no per-check exclusion flag at all**. The complete filter
set is `--required`, `--fail-fast`, `-i`, `--watch`, `--web`. So:

- **No human gate on this repo?** Rung 2 as written. This is the common case.
- **Human gate that isn't required, AND every check you need to settle _is_ required?**
  Only then is `--required` safe. It hides *all* non-required checks, not just the gate —
  so if any CI job or reviewer you're waiting on is also non-required (CodeRabbit often
  isn't), `--watch` returns while it's still pending, which is the mid-run triage this
  section forbids. Verify that precondition per repo; if you can't, use rung 3.
- **Human gate that _is_ required?** Rung 2 can't express this. **Skip to rung 3** — the
  loop below excludes gates by name, which is the only way to do it.

Limitation: it watches **only checks**. It won't wake you for a new review comment, and
a comment-only reviewer (Codex posts no check at all) is invisible to it. Pair it with a
comment sweep after it returns.

If the harness has an event watcher (rung 1) that streams new comments *and* check
results, prefer that — it covers both signals at once.

Fall back to the loop below only when neither is available.

> ⚠️ **`gh pr checks --json` is NOT available on every `gh`.** Verified: on `gh 2.45.0`
> it is `unknown flag: --json` — the whole flag set is `--fail-fast --required
> --interval --watch --web`. Because the loop below fails closed on empty output, an
> older `gh` makes it **spin every iteration and never settle**, then time out — it
> looks like slow CI, not a broken command. If you need one snippet that works on any
> version, read check state from the **REST API** instead, which is stable across gh
> releases:
>
> ```bash
> # --paginate on BOTH: each endpoint defaults to per_page=30, so a matrix build's
> # later jobs (or a pending one) are simply absent from an unpaginated first page.
> gh api "repos/$REPO/commits/$SHA/check-runs" --paginate \
>   --jq '.check_runs[] | "\(.name)\t\(.status)\t\(.conclusion // "-")"'
> gh api "repos/$REPO/commits/$SHA/status" --paginate \
>   --jq '.statuses[]  | "\(.context)\t\(.state)\t\(.description)"'   # description ⇒ rate-limit trap
> ```
>
> Check `gh pr checks --help` for `--json` before relying on the loop below.

```bash
# Bind this rung to ONE head as well — rung 2 does it at (a)/(f), and rung 3 settles on
# exactly the same evidence.
# RESOLVE IT UNCONDITIONALLY, every round. A `${SHA:-…}` default looks harmless but is a
# one-way trap: the driver re-runs this loop in the SAME shell after each fix push, so
# round 2 would keep round 1's SHA, poll the NEW head, and then fail the (f)-style
# comparison against the OLD one — reporting "head moved" on every subsequent round,
# forever, until the caller thinks to unset SHA. Rungs 2 and 3 are alternatives, not a
# sequence, so there is no earlier value worth inheriting.
SHA=$(gh pr view "$PR" --repo "$REPO" --json headRefOid --jq .headRefOid)
[ -n "$SHA" ] || { echo "could not resolve PR head" >&2; exit 1; }
settled=0
for i in $(seq 1 50); do
  # Structured output (don't grep text); FAIL CLOSED — an errored/empty result is
  # treated as "not settled" so a transient gh/network failure can't look settled.
  # gh pr checks exits non-zero while checks are pending/failing but STILL prints the
  # JSON (pending → exit 8, documented; failing → exit 1 per gh source) — so `|| true`
  # keeps the captured stdout (don't clobber it to ""). Only a genuinely empty result
  # (a real gh/network failure) is treated as "not settled".
  # ⚠️ Requires a gh with `--json` on `pr checks` — see the warning above; on an older
  # gh this is always empty and the loop can never settle.
  checks=$(gh pr checks "$PR" --repo "$REPO" --json name,bucket 2>/dev/null) || true
  if [ -n "$checks" ]; then
    # Count REAL (non-human-gate) checks: how many registered, how many still pending.
    # Replace "Approval Agent" with YOUR repo's human-gate check name(s). # <-- tune this
    real=$(printf '%s' "$checks" | jq '[.[] | select(.name|test("Approval Agent")|not)] | length')
    blocking=$(printf '%s' "$checks" |
      jq '[.[] | select(.bucket=="pending" and (.name|test("Approval Agent")|not))] | length')
    # Settle when no REAL (non-gate) check is pending, AND either a real check has
    # registered OR a grace period (~iters*30s) has elapsed. The grace window avoids
    # settling in the startup race (CI not registered yet) while still letting a
    # gate-only / no-CI repo settle (so a passed-gate-only PR isn't stuck until timeout).
    if [ "${blocking:-1}" -eq 0 ] && { [ "${real:-0}" -gt 0 ] || [ "$i" -ge 3 ]; }; then
      # THE HEAD CAN MOVE MID-LOOP — same rule as rung 2 (f). The checks just read belong
      # to $SHA; a push during the wait means this evidence describes a commit you are no
      # longer triaging. Restart rather than mix two commits.
      NOW=$(gh pr view "$PR" --repo "$REPO" --json headRefOid --jq .headRefOid) || NOW=""
      if [ -z "$NOW" ] || [ "$NOW" != "$SHA" ]; then
        echo "head moved ${SHA:0:7} -> ${NOW:-?} during the wait — restart, do not triage" >&2
        exit 1
      fi
      # Guard the display call too: it exits 1 (settled-red) / 8 (pending), which under a
      # `set -e` caller aborts on exactly the outcome you were waiting to report.
      echo "settled"; gh pr checks "$PR" --repo "$REPO" || true; settled=1; break
    fi
  fi
  sleep 30
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
on `path:line` makes everything look "new." Match on the stable id instead. The
per-bot marker formats below (and the same regexes embedded in queries b/c above) are
canonically tracked in [`known-bots.md`](./known-bots.md) — update all in sync if a
marker format changes:

- **Cursor Bugbot:** `BUGBOT_BUG_ID: <uuid>` in the comment body.
- **CodeRabbit:** `cr-comment:v1:<hash>` — the per-comment id (use this). A
  `fingerprinting:…` marker also appears but is a coarse *category* repeated across
  comments, **not** a per-comment id — don't dedup on it (it would merge distinct findings).
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
Rejecting <finding>: <one-line reason>.
EOF
)"
# Append "@coderabbitai — resolved on HEAD, please re-scan" to the body ONLY to teach a
# learner with a genuine insight (two-axes rule below) — not on every reject.
```

- Tag per the two-axes decision in `SKILL.md` (values in
  [`known-bots.md`](./known-bots.md)): **teach** only learners (e.g. `@coderabbitai`
  re-scans and records Learnings), and only with a real insight to give; **re-trigger**
  only on-demand-cadence reviewers (`@handle review` / Reviewers-menu re-request), and
  **only when you reach a HEAD you believe is final/converged, not on every fix round**
  (each re-trigger is a metered review; a final-pass fix makes a new final HEAD that
  gets its own re-trigger) — per-push bots re-review themselves.
- Don't tag bots that have re-posted resolved findings repeatedly — it's noise; and if
  a bot you've engaged keeps treating replies as fresh work, stop tagging it entirely.
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

## Minimise review triggers — batch the round

Incremental/per-push reviewers re-run on **every** trigger (push, manual-review
request, eligible CLI run) and re-emit the **same consolidated set** each time — so a
per-finding commit stream reads as a repeated "N findings" and can spend a **review
allowance/quota** per trigger. Keep triggers few and each one meaningful:

- **One batched push per review round.** Settle → enumerate → triage the *whole* round
  (fix all valid, decide rejects/stale) → push **once**. Local commit granularity is
  free (squash-merge collapses it anyway); it's the **push** that triggers the
  re-review, so batch fixes behind a single push rather than pushing per finding.
- **Don't double-run a reviewer's surfaces.** If a reviewer has both a CLI and a hosted
  bot, don't let both review the **same pushed SHA** — two on one commit produce
  overlapping/near-duplicate findings, double the consumption, and leave two surfaces to
  reconcile. The guard is cadence-dependent: if the hosted bot **auto-reviews every
  push** it will review the pushed SHA anyway, so let it be the one surface and **skip
  the CLI** on that commit; only reach for a **CLI-before-push** pass when the hosted bot
  **won't** also review that SHA (it's paused, on-demand, or not installed) — then the
  CLI is your one surface and you push an already-clean batch.
- **Consolidate replies.** One status-table/summary comment per round instead of a reply
  per thread — each individual reply can make a *learner* re-acknowledge and re-analyse
  (extra churn, and for incremental reviewers, extra triggers). @-mention once, only to
  teach or to re-trigger (per the two-axes rule).
- **Watch for phantom "new" findings.** A repeated identical count across pushes is
  usually the same set re-presented, not fresh defects — dedup by stable id (above)
  before treating a re-post as new work. Real convergence is *fewer open threads*, not
  a quieter summary line.

Target shape: initial review → one batched fix push → one final re-review → hand off.

## Convergence — the honest definition

Hand off only when **all three** hold, all keyed on the **current HEAD SHA**, never
on wall-clock:

1. **Every expected reviewer has weighed in on the current HEAD.** The **expected set
   is the per-push automated reviewers** — the bots that re-review every commit (those
   posting a check on the PR, or that re-reviewed a prior push) — **plus any on-demand
   reviewer whose sign-off you still need**: on-demand bots don't re-review a new
   commit on their own, so re-trigger them **here, on the final HEAD** (`@handle
   review` — cadence per [`known-bots.md`](./known-bots.md)) and wait for the fresh
   pass; don't silently drop them from the set (if you decide a bot's sign-off isn't
   required, say so in
   the summary). It is **not** every login that ever commented. The reliable per-bot
   signal is its **check completing on HEAD** (the settle-poll already waits for that)
   and/or a review or inline comment attached to HEAD. A top-level **issue comment counts only when it explicitly names the current HEAD SHA** (issue comments aren't commit-attached — a stale one must not satisfy this gate); otherwise treat it as a finding input, not reviewer-completion evidence. **Do not block
   handoff on one-shot or human reviewers** who won't re-post on each push — their
   input is captured as open findings in gate 2, which you address regardless. A green
   check alone can precede the comments, so it's never sufficient on its own — pair it
   with gate 2.
2. **No open finding remains untriaged on HEAD** — covering **both** sources: every
   **unresolved review thread** (query b) *and* every finding posted as a **top-level
   issue comment** (query c — these have no thread/resolve state, so track them by
   stable id **when available, else by rule+file identity** — see `known-bots.md`).
   Enumerate in full (no time/commit slice); each must reach a **terminal
   verdict** — fixed, rejected-with-reason, confirmed stale by checking the file, or
   kept-with-reason. A **`Deferred`** finding is *not* terminal: it blocks hand-off
   unless it's tracked in a follow-up issue/PR *and* the human has accepted the
   deferral (see the status-table verdicts in `SKILL.md`).
3. **All required checks green.**

Non-deterministic LLM reviewers keep emitting marginal/duplicate comments, so "zero
open findings" isn't always reachable — but every finding (thread **or** issue comment)
must be *accounted for* (fixed / rejected / stale / kept-with-reason, or an
accepted-and-tracked `Deferred`), never skipped because of when or which commit it sits
on. Document rejected/stale/kept items and any accepted deferral, then hand off.
