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
  author: stealth-engine
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

(Consumers of this repo install instead with `npx skills add stealth-engine/skills`.)

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
- Bump `metadata.version` (semver) on a meaningful change.
- Conventional Commits for messages (`feat(skill): …`, `docs: …`, `fix: …`).
