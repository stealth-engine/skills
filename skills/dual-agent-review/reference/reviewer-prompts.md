# Reviewer prompts, CLI recipes & report template

Copy-paste material for [`../SKILL.md`](../SKILL.md). Fill the `{{placeholders}}`.

---

## Reviewer A — Sonnet subagent (general code review)

Spawn a subagent with **model `sonnet`**, read-only intent (it returns findings; it
does **not** edit). Give it the diff plus the changed files for context.

> You are an independent code reviewer. Review **only the change set below** against
> the rest of the repo for context. Do not review unrelated code.
>
> Base: `{{base}}` · Changed files: `{{file list}}`
> Diff:
> ```diff
> {{git diff <base>...HEAD}}
> ```
>
> Read the full changed files (and immediate callers) as needed for context, but
> **report only on changed lines**. Look for: correctness bugs, security issues,
> broken edge cases, race conditions, resource leaks, error-handling gaps, API
> misuse, and regressions. Skip pure style unless it causes a bug.
>
> Return a JSON array; each item:
> `{ "file": "", "line": 0, "severity": "critical|warning|info", "claim": "what's
> wrong, one sentence", "evidence": "why it's wrong", "fix": "suggested change" }`
> Return `[]` if nothing real. Do not invent issues to seem thorough — a clean diff
> is a valid result.

**Optional extra lenses (Reviewer C+)** — same shape, swap the focus line:
- *Security:* "Focus on authn/authz, injection, secrets, SSRF, unsafe deserialization,
  path traversal, and untrusted-input handling."
- *Performance:* "Focus on N+1 queries, unbounded loops/allocations, blocking I/O on
  hot paths, and missing caching/pagination."

---

## Reviewer B — CodeRabbit CLI

Run inside a subagent (ideally `run_in_background` — reviews can take minutes).
Confirm auth first; if it fails, report "CodeRabbit unavailable" and let the
orchestrator proceed with the other reviewer(s).

```bash
coderabbit auth status || { echo "CodeRabbit not authenticated"; exit 0; }

# Structured output for agents (preferred — parse the JSON):
coderabbit review --agent -t committed --base "{{base}}"

# Or detailed plain text:
coderabbit review --plain -t committed --base "{{base}}"
```

- `-t` — review type: `all` | `committed` | `uncommitted` (match the diff you scoped).
- `--base` — branch to compare against (e.g. `main`).
- `--agent` — structured JSON for agent/skill integrations; `--plain` — detailed text.
- Flags evolve — run `coderabbit review --help` to confirm the current set before relying on it.

CodeRabbit groups findings by **Critical / Warning / Info**; map those onto the same
`{file, line, severity, claim, evidence, fix}` shape so they merge cleanly with
Reviewer A's. Return the normalized array to the orchestrator.

---

## Parallel fix-subagent (one per valid, independent issue)

Only after triage. One issue per subagent; **never two fixers on the same file at
once** (partition by file or give each an isolated worktree).

> Apply this single, pre-approved fix. Scope: **one file, one issue.** Do not refactor
> beyond it or touch other files.
>
> File: `{{file}}` · Issue: `{{claim}}` · Approved fix: `{{fix}}`
>
> Make the minimal change in the surrounding code's style. Then verify it (build /
> relevant test / re-read) and report back: `{ "file": "", "applied": true|false,
> "how": "what you changed", "verified": "what you ran/checked" }`. If the fix turns
> out wrong or unsafe, make **no** change and report `applied: false` with why.

---

## Final report template

```markdown
## Dual-agent review — {{base}}...HEAD ({{N}} files)
Reviewers: Sonnet · CodeRabbit{{· extra lenses}}

### ✅ Fixed ({{count}})
- **{{file}}:{{line}}** — {{claim}} _(flagged by: {{A/B/both}})_
  → {{how it was fixed}}; verified: {{check}}

### ⛔ Ignored / rejected ({{count}})
- **{{file}}:{{line}}** — {{claim}} _(flagged by: {{A/B}})_
  → Rejected: {{one-line reason}}

### ⏸ Deferred / needs human ({{count}})
- **{{file}}:{{line}}** — {{claim}}
  → {{why deferred / what decision is needed}}

### Adjudicated disagreements
- {{reviewer A said X, B said Y → call + why}}

**Tally:** fixed {{n}} · rejected {{m}} · deferred {{k}} · verify: {{pass/fail + what ran}}
```

Keep it honest: only list under **Fixed** what the verify step actually confirmed;
everything else is **Deferred**.
