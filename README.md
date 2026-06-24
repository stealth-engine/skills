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
| [`skill-publishing`](./skills/skill-publishing/SKILL.md) | How to author and publish agent skills for the `npx skills` ecosystem — the `SKILL.md` format, the description-as-trigger rule, multi-skill repo layout, the `skills` CLI, publishing to GitHub with SEO, and public vs private repos. |
| [`nextjs-locale-standalone`](./skills/nextjs-locale-standalone/SKILL.md) | Add locale-prefixed i18n routing to a single Next.js App Router site — a middleware/proxy that redirects `/` to `/<locale>/…` by the toggle's last choice (`NEXT_LOCALE` cookie) then `Accept-Language`, a `[locale]` layout + `LocaleProvider`/hooks, and a `LocaleToggle`. Ships copy-paste templates. |
| [`nextjs-locale-monorepo`](./skills/nextjs-locale-monorepo/SKILL.md) | The same locale routing factored into a shared workspace package (Turborepo / pnpm) every app consumes — detection + a middleware factory + a `use client` provider with a dual ESM/CJS build, a shared `supportedLanguages` config, and thin per-app wiring. Ships the package + app templates. |
| [`code-complexity-stats-pr`](./skills/code-complexity-stats-pr/SKILL.md) | A GitHub Actions workflow that runs `scc` on every PR and posts code-size + a COCOMO "cost to build" estimate as a self-updating sticky comment. Covers fork-PR token limits, runner arch, version pinning, comment pagination, and the 65k comment cap. Ships the workflow template. |
| [`conventional-commits`](./skills/conventional-commits/SKILL.md) | The Conventional Commits / "semantic commits" format — `type(scope): description`, the type→semver mapping, breaking changes, monorepo scopes, and squash-merge PR titles — and why non-conventional messages silently skip releases. The foundation for automated versioning + changelogs. |
| [`semantic-release-automation`](./skills/semantic-release-automation/SKILL.md) | Automate versioning, changelog, tags, GitHub Releases, and npm publishing from Conventional Commits with semantic-release — the plugin pipeline, single-package vs monorepo (per-package tags + paths-filter matrix) flavors, the Actions workflow + no-loop guard, and pooled releases. Ships `.releaserc` + workflow templates. |

## Repository layout

```
skills/
  <skill-name>/
    SKILL.md         # entry: frontmatter (name + description) + the skill body
    reference/*.md   # optional — deep docs the skill links to, loaded on demand
    scripts/*        # optional — runnable helpers the skill invokes
    templates/*      # optional — boilerplate the skill copies
README.md
AGENTS.md            # conventions for authoring skills in this repo
```

The `skills` CLI auto-discovers `skills/<name>/SKILL.md` (flat) and
`skills/<category>/<name>/SKILL.md` (categorised) — no manifest required.

A skill is a **directory**, not just one file: `SKILL.md` is the entry point, and
only its body loads when the skill fires. Anything else (reference docs, scripts,
templates) loads/runs **only when `SKILL.md` references it** — keep `SKILL.md`
focused and push heavy material into siblings (progressive disclosure). The whole
directory installs together, so relative links keep working.

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
