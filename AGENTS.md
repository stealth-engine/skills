# AGENTS.md

Instructions for AI agents (and humans) authoring skills in this repository.

## What this repo is

A collection of [skills.sh](https://www.skills.sh)-compatible **agent skills**.
Each skill is reusable, on-demand context for an AI coding agent. One skill =
one folder under `skills/` with a `SKILL.md`.

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

## Adding a skill

```bash
npx skills init skills/<skill-name>   # scaffolds the folder + SKILL.md
```

Then fill in the frontmatter + body, add a row to the **Skills** table in
`README.md`, and commit.

## Conventions

- One concern per skill. Split rather than overload.
- Bump `metadata.version` (semver) on a meaningful change.
- Conventional Commits for messages (`feat(skill): …`, `docs: …`, `fix: …`).
