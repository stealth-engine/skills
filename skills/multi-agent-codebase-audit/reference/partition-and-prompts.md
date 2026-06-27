# Partitioning, prompts & the coverage ledger

Copy-paste material for [`../SKILL.md`](../SKILL.md). Triage, the parallel
fix-subagent prompt, and the fixed/ignored report format are **reused from
[`dual-agent-review`](../../dual-agent-review/SKILL.md)** — this file covers only the
whole-repo additions: mapping, partitioning, the auditor + critic prompts, and the
ledger.

---

## 1. Map the repo (commands)

```bash
git ls-files | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn | head -40   # files per dir
scc --by-file --format wide . 2>/dev/null | tail -30                       # LOC/complexity (scc)
find . -maxdepth 3 -name package.json -o -name go.mod -o -name pyproject.toml \
  -o -name Cargo.toml 2>/dev/null | grep -v node_modules                   # module roots
```

Use the output to choose slice boundaries and to seed the coverage ledger.

## 2. Partition heuristics

- **Cut on natural seams:** package/module roots, top-level dirs, ownership
  (CODEOWNERS), or layer (api / domain / ui).
- **Budget per slice:** keep a slice small enough that an agent can read its files
  *in full* (not skim). If a dir is too big, split by subdir or file-group; if many
  dirs are tiny, group siblings into one slice.
- **Shared/core is its own slice** and is named as a dependency for the slices that
  use it.
- **Every path lands somewhere:** each file is in exactly one slice **or** on the
  exclusion list (vendored, generated, lockfiles, fixtures) with a reason.
- **Scale to size:** small service → 2–4 slices; monorepo → one (or more) per package.

---

## 3. Per-slice auditor subagent

Spawn per slice (model `sonnet` or stronger), read-only (returns findings; no edits):

> You are auditing **one slice** of a larger codebase. Audit **only these files**;
> the rest is context you may read but must not review.
>
> Slice: `{{paths in this slice}}`
> Depends on (contracts only — do not review): `{{interfaces/exports of other slices}}`
>
> Read the slice's files **in full**. Look for: correctness bugs, security issues
> (authn/authz, injection, secrets, unsafe input), resource leaks, race conditions,
> error-handling gaps, API misuse, and dead/duplicated logic. Judge calls into other
> slices against the contracts above — don't flag a function you can't see as missing.
>
> Return a JSON array of `{ "file": "", "line": 0, "severity":
> "critical|warning|info", "claim": "", "evidence": "", "fix": "" }`. Return `[]` if
> the slice is clean — an empty result for a **small** slice is fine; for a **large**
> slice, double-check before returning empty.

**Second lens (high-risk slices)** — same shape, swap the focus:
- *Security:* "Focus only on the trust boundary: authn/authz, injection, SSRF, secrets,
  unsafe deserialization, path traversal, and untrusted-input flow."

---

## 4. Cross-cutting / architecture critic

Run once, after slice findings are in:

> You are the architecture critic for a whole-repo audit. Here are all per-slice
> findings: `{{merged findings}}`. Here is the global surface: `{{dependency
> manifests, auth/trust map, config/env files, repeated-pattern notes}}`.
>
> Find issues **no single slice could see**: inconsistent patterns across modules,
> layering/dependency violations, the same defect class repeated in many places,
> duplicated logic that should be shared, stale or vulnerable dependencies, and
> secrets or misconfig in config/CI. Return findings in the same JSON shape, each
> tagged `"scope": "cross-cutting"`.

## 5. Completeness critic

> Given the partition map `{{slices + exclusions}}` and what each slice returned
> `{{per-slice result + size}}`, identify gaps: large slices that returned empty
> (suspicious), directories in neither a slice nor the exclusion list, and untouched
> areas (generated code, tests, CI/config). List what to **re-audit or add as a new
> slice**. Return `{ "reaudit": [], "newSlices": [], "covered": true|false }`.

Loop steps 3–5 until the completeness critic returns `covered: true` **and** a round
adds nothing new (loop-until-dry).

---

## 6. Coverage ledger (goes in the final report)

Append to `dual-agent-review`'s fixed/ignored/deferred report so the audit's scope is
auditable:

```markdown
### 🗺 Coverage ledger
Audited slices ({{n}}):
- `{{slice path}}` — {{LOC}} — {{auditor(s)}} — {{n findings}}
Excluded (not audited):
- `{{path}}` — {{reason: vendored / generated / lockfile / out of scope}}
Cross-cutting pass: {{run? n findings}} · Completeness: {{covered: yes/no, rounds: k}}

**Scope statement:** {{"Full repo" | "Bounded to <subtree> because <reason>"}}
```

If anything was bounded or skipped, **say so here** — never let a partial audit read
as a full one.
