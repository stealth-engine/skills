# Stealth Engine — Agent Skills

A collection of **agent skills** we use daily in the studio — reusable, on-demand
context and instructions for AI coding agents (Claude Code, Cursor, and other
[skills.sh](https://www.skills.sh)-compatible agents).

Each skill is a folder under [`skills/`](./skills) containing a `SKILL.md`: YAML
frontmatter (`name` + a trigger `description`) and a markdown body the agent loads
only when the skill is relevant.

## Install

Using the [`skills` CLI](https://github.com/vercel-labs/skills) (no install needed):

```bash
# Interactive — pick which skills (and which agents) to install:
npx skills add stealth-engine/skills

# Browse what's in here without installing:
npx skills add stealth-engine/skills --list

# Install a specific skill:
npx skills add stealth-engine/skills --skill safari26-liquid-glass

# Install everything, globally (available in every project):
npx skills add stealth-engine/skills --all -g
```

Manage installed skills with `npx skills list`, `npx skills update`, and
`npx skills remove`.

## Skills

| Skill | What it's for |
| ----- | ------------- |
| [`safari26-liquid-glass`](./skills/safari26-liquid-glass/SKILL.md) | How iOS 26 / iPadOS 26 Safari's "Liquid Glass" status & address bars interact with web content — the viewport/keyboard facts, why `position:fixed` breaks the bleed, the keyboard layout bug (WebKit #297779), and case-dependent fixes for immersive/edge-to-edge designs, custom drawers, and themeable backgrounds. |
| [`agents-md-setup`](./skills/agents-md-setup/SKILL.md) | Set up a project's agent instructions as one source of truth: `AGENTS.md` as the real file with `CLAUDE.md` (and other tools' files) symlinked to it. Bootstraps a repo, converts a standalone `CLAUDE.md`, or fixes duplicated/drifting instruction files. |

## Repository layout

```
skills/
  <skill-name>/
    SKILL.md        # frontmatter (name + description) + the skill body
README.md
AGENTS.md           # conventions for authoring skills in this repo
```

The `skills` CLI auto-discovers `skills/<name>/SKILL.md` (flat) and
`skills/<category>/<name>/SKILL.md` (categorised) — no manifest required.

## Adding a skill

```bash
npx skills init skills/<skill-name>   # scaffolds skills/<skill-name>/SKILL.md
```

See [`AGENTS.md`](./AGENTS.md) for the conventions (what makes a good `description`,
how to keep the body focused, etc.).

## License

[MIT](./LICENSE) © Stealth Engine

---

<sub>Keywords: agent skills · Claude Code skills · Claude skills · AI agent context ·
skills.sh · Cursor skills · iOS 26 Safari Liquid Glass · prompt engineering.</sub>
