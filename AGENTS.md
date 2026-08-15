# AGENTS.md

Instructions for AI agents (and humans) authoring skills in this repository.

## What this repo is

A collection of [skills.sh](https://www.skills.sh)-compatible **agent skills**.
Each skill is reusable, on-demand context for an AI coding agent. One skill =
one folder under `skills/` with a `SKILL.md`.

**Project tracking:** [Linear — Skills](https://linear.app/stealth-company/project/skills-2bf14f088070/overview).

## Layout

```
skills/<skill-name>/SKILL.md          # flat (preferred)
skills/<category>/<skill-name>/SKILL.md   # only if you have enough to categorise
```

`<skill-name>` is kebab-case and matches the `name:` in the frontmatter. No
manifest file is needed — the `skills` CLI auto-discovers these paths.

## SKILL.md format

```markdown
---
name: my-skill                # kebab-case, matches the folder
description: <one line>        # SEE BELOW — this is the most important field
metadata:
  author: stealth-factory
  version: "1.0.0"            # bump on meaningful change (semver)
---

# Title

<the body the agent loads when the skill fires>
```

### The `description` is the trigger (write it carefully)

It's the **only** part of a skill that's always in the agent's context; the body
loads **only when the description matches** the task. So write it as **concrete
triggers**, not marketing:

- Good: `Use when an iPhone/iPad page shows black bars, content is cut off at the
  bar edge, a cropped shadow, or the page jumps after the keyboard closes.`
- Bad: `Helps with iOS Safari styling.`

Lead with what the skill does, then "Use when …" listing the situations, symptoms,
and phrases a user might say.

### The body

- Write for the **agent**, not end users — actionable facts, steps, rules.
- Keep it **scannable** (headings, short sections, tables, code blocks).
- **Progressive disclosure:** keep `SKILL.md` focused; if a skill needs heavy
  reference material or scripts, put them in sibling files and link to them so
  they load only when needed.
- Prefer **facts and case-dependent guidance** over a single rigid recipe, so the
  skill stays useful across situations.
- Note provenance (how a non-obvious claim was verified) when it helps trust.

## Bundling files in a skill

A skill is a **directory**, not just `SKILL.md`. You may ship reference docs,
scripts, templates, or assets alongside it:

```
skills/<skill-name>/
  SKILL.md          # entry: frontmatter + concise body
  reference/*.md    # optional — deep detail, read on demand
  scripts/*         # optional — runnable helpers the skill invokes
  templates/*       # optional — boilerplate the skill copies
```

Only `SKILL.md`'s body loads when the skill fires; everything else loads/reads/
runs **only when `SKILL.md` references it** (by relative path). Keep `SKILL.md`
short and push heavy material into siblings. The CLI installs the whole
directory, so relative links keep working. Small skills are fine as a single
`SKILL.md` — split only when it gets large or needs helpers.

## Adding a skill

```bash
npx skills init skills/<skill-name>   # scaffolds the folder + SKILL.md
```

Then fill in the frontmatter + body, add a row to the **Skills** table in
`README.md`, and commit.

## Dogfooding — these skills are available while working in this repo

Every skill under `skills/<name>/` is symlinked into the agent-discovery dirs so
**Claude Code and Codex (and other agents) pick them up automatically** when working
in this repo:

```
.claude/skills/<name>  ->  ../../skills/<name>   # Claude Code
.agents/skills/<name>  ->  ../../skills/<name>   # Codex / universal
```

The links are **relative**, so they resolve in any clone or worktree, and they point
at the **working-tree** skill (edits are live — no reinstall). When you add a skill,
re-link it:

```bash
for d in skills/*/; do n=$(basename "$d"); \
  ln -sfn "../../skills/$n" ".claude/skills/$n"; \
  ln -sfn "../../skills/$n" ".agents/skills/$n"; done
```

(Consumers of this repo install instead with `npx skills add stealth-factory/skills`.)

## Environment facts — verify the toolchain; don't assume the docs

These gaps were verified on `gh` **2.45.0** and each cost a real defect in a shipped
skill. **They are compatibility notes, not a claim about the current machine.**
`gh` versions vary across checkouts (2.45.0, 2.91.0, and 2.96.0 have all shown up).
Detect the installed version (`gh --version`) and **run the exact invocation in the
form it will ship** — a flag in a manual is not verification.

| Assumption | Reality on `gh` 2.45.0 | How it fails |
| --- | --- | --- |
| `gh pr checks --json …` | **`unknown flag: --json`** (present on 2.91+) | A loop that captures empty output and fails closed **spins forever and times out**, looking like slow CI rather than a broken command |
| `gh api --jq --arg k v '…'` | **`accepts 1 arg(s), received 4`** — `gh api` takes `--jq <expr>` but forwards **no** jq CLI flags (still true on 2.91) | The query never runs; its subject looks *silent* rather than unqueried. Use exported vars + `env.NAME` |
| `gh api --slurp` | **absent** on 2.45.0 (present on 2.91+) | Suggested by reviewers as a paginate fix; adopting it on an older `gh` reintroduces the same class of bug |
| `gh skill install …` | **`unknown command`** on 2.45.0 (present on 2.91+) | `gh extension install` still works |
| exit code `1` = "checks failed" | **overloaded** — a nonexistent PR, an unknown repo and a bad flag *all* exit 1 | An API error reads as "CI finished red" and you triage a build that never ran |
| `timeout` is available | **GNU coreutils** — absent on stock macOS/BSD | A "portable" recipe dies with `command not found` |

**The rule this earned: run the exact invocation, in the form it will ship.** Reading a
flag in a manual is not verification — three separate defects here passed a docs check
and failed on first execution. The API is the source of truth; an exit code is a hint.

## Review bots in this repo

Both PR-driving skills depend on these; re-verify if behaviour diverges.

- **CodeRabbit** (`coderabbitai[bot]`) — check-backed, but its green tick is **not proof
  of review**: `state=success` with `description="Review rate limited"` means it never
  looked (vs `"Review completed"`). Read the description, never the colour. It is also
  **starved by a fast push cadence** — on one 16-commit PR it was throttled on 7 of the
  last 9 heads, because each push consumed the slot the previous throttle had released.
  Batch a whole round into one push.
- **Codex** (`chatgpt-codex-connector[bot]`) — posts **no status check at all**, so it
  never appears in the rollup and silence from it is ambiguous. It is nonetheless the
  **highest-signal reviewer** observed here. On one 16-commit PR it arrived **2–4
  minutes after every push, 17/17** — that is one observed path, not a guarantee.
  The bot snapshot also records a slow path (no response ~8 minutes after an
  explicit trigger). Neither a push nor a tag guarantees timely review. Bound the
  wait, then disclose if it never reported — don't treat a short quiet period as
  proof it looked.
- **Findings arrive as comments, not check failures.** On a 16-commit PR: **44
  comment-delivered findings, 0 failing checks.** Any wait that only watches checks —
  including `gh pr checks --watch` — reports "all settled" while every real finding sits
  unread. Always pair a check wait with a comment sweep.

**Driving a PR here:** `/autofix-pr` is enabled on this account and can drive a PR from a
cloud session, pushing commits itself. **Only one agent should push to a branch at a
time** — if a cloud session owns the branch, stay read-only and branch off `main` for
unrelated work.

## Branching & pull requests

This repo uses a **feature-branch + PR** workflow. Do **not** commit directly to
`main`.

- **Branch per change:** `feature/<kebab-desc>` off `main` (e.g.
  `feature/conventional-commits`). Build larger work in a git **worktree** so each
  change stays isolated.
- **Open a PR** with a **Conventional Commits title** — it becomes the squash-merge
  commit message, so it must be semantic (`feat(skill): …`, `docs: …`, `fix: …`).
- **Squash merge** to `main` (one PR = one commit on `main`).
- **Don't self-merge:** leave the PR for review and **ask before merging**.

## Conventions

- One concern per skill. Split rather than overload.
- Bump `metadata.version` (semver) on a meaningful change. Publisher metadata
  alone (`author:` rename, display-name/branding) is not a version bump —
  consumers resolve skills by repo path, not by that field.
- Conventional Commits for messages (`feat(skill): …`, `docs: …`, `fix: …`).

## Writing skills that survive review

These are not style preferences. Each is a failure pattern that produced multiple real
defects here, and each is cheap to avoid once named.

- **Shipping shell in a judgment skill creates an unbounded review surface.** One
  30-line recipe drew a defect in *nearly every review round* of a 16-commit PR; the two
  blocks reduced to *stated requirements* produced none afterwards. Prefer stating the
  rule ("check each lookup independently") over shipping a reference implementation of
  it. Prose cannot rot; shell does. When an addition keeps attracting findings,
  **simplify or drop it** rather than patch it a third time.
- **Any construct that folds several results into one exit status will hide the one that
  failed.** Same defect, three costumes, three separate rounds: `$(cmd) || echo 0` turned
  an API error into "zero results"; `export VAR=$(cmd)` always returns 0; `{ a; b; }`
  takes the *last* command's status; a pipeline does too unless `pipefail` is set.
  Capture and test each lookup on its own.
- **A failed lookup is missing evidence, never a negative result.** Fail closed. Most
  fail-open cases here were error paths quietly reading as "nothing found".
- **Prefer an allowlist of the terminal state over a denylist of pending ones.**
  Enumerating `queued|in_progress|pending` went stale the moment `waiting`/`requested`
  appeared. Treat only `status == "completed"` as terminal; then read `conclusion`
  to distinguish `success`, `failure`, `cancelled`, and other outcomes.
- **Silence is not success.** A guard, watcher, or query that cannot emit on its failure
  path is indistinguishable from a quiet system. Two watchers in one session were each
  half-dead for many rounds without ever announcing it. Before trusting one, make it
  prove it fires on a known event.
- **When adding to a file, diff against what the file already claims.** Three defects
  came from writing something that contradicted correct guidance already present 70 lines
  away. Simplification is the same hazard in reverse: **diff what you delete** — one
  "cleanup" silently removed a safeguard and reopened a closed fail-open.
- **Verify a reviewer's suggested *mechanism*, not just its concern.** Twice a proposed
  fix (`--slurp`) was itself unavailable on the `gh` that shipped the skill. Take the
  finding; check the remedy.

## Driving review (see `skills/autonomous-pr-driver/`)

- **Stop pushing ≠ stop watching.** Diminishing returns should end the *fix cadence*, not
  the session's attention. Ending both is what makes a driver look like it gave up.
- **Prefer a stateless re-sweep over a clever incremental watcher.** The watcher bugs
  here came from incremental state — seen-sets and per-page `jq` — and from incorrect
  author-filter handling. Re-running the full enumeration from scratch has nothing to rot.
- **A PR subscription that processes its own events feeds itself.** Independently
  observed in two separate implementations: the loop's own replies wake it. Filter
  out the current agent's identity even when the sweep is stateless.
- **Pushed events can be stale.** A webhook describes the moment it was emitted, so an
  event may name a commit that is no longer HEAD. Re-read HEAD before acting; polling
  always reads current state, push does not.
