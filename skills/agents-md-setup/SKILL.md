---
name: agents-md-setup
description: Set up a project's agent instructions as a single source of truth — AGENTS.md as the real file, with CLAUDE.md (and optionally other agents' files) as symlinks to it. Use when starting/bootstrapping a repo, when asked to "add a CLAUDE.md / AGENTS.md", "set up project conventions / agent instructions", "make Claude use AGENTS.md", or when a repo has a standalone CLAUDE.md that should become cross-tool. Also use to fix duplicated/drifting CLAUDE.md + AGENTS.md, or to add per-workspace instructions in a monorepo (Turborepo / pnpm workspaces).
metadata:
  author: stealth-engine
  version: "1.0.0"
---

# agents-md-setup

Make **`AGENTS.md` the single source of truth** for agent/project instructions,
and point every tool's file at it via **symlink**. One file, read by all agents —
no duplication, no drift.

## Why this layout

- `AGENTS.md` is the emerging cross-tool standard (Cursor, Codex, and others read
  it).
- Claude Code reads `CLAUDE.md`. You **cannot** make the harness read `AGENTS.md`
  instead via a prompt or a skill — but a **symlink** `CLAUDE.md → AGENTS.md`
  means Claude opens `CLAUDE.md` and gets `AGENTS.md`'s content. That *is* the
  mechanism; nothing else is needed.
- Result: edit `AGENTS.md` only; every agent stays in sync.

## Decision: what's already there?

1. **Neither file** → create `AGENTS.md` from the template below.
2. **Only `CLAUDE.md` (a real file)** → make it the source of truth:
   ```bash
   git mv CLAUDE.md AGENTS.md       # preserve history (or: mv if not tracked)
   ```
3. **Only `AGENTS.md`** → keep it as-is (good).
4. **Both exist as real files** → do NOT blindly overwrite. Compare them; merge
   into `AGENTS.md` (it wins as the canonical file), confirm with the user if the
   contents differ, then remove the standalone `CLAUDE.md`.
5. **`CLAUDE.md` already a symlink → `AGENTS.md`** → already done; stop.

## Create the symlink

```bash
ln -s AGENTS.md CLAUDE.md
git add AGENTS.md CLAUDE.md        # git stores it as a real symlink (mode 120000)
```

Verify it committed as a symlink, not a copy:

```bash
git ls-files -s CLAUDE.md          # mode should be 120000
```

Optionally point other tools at the same file:

```bash
ln -s AGENTS.md GEMINI.md
mkdir -p .github && ln -s ../AGENTS.md .github/copilot-instructions.md
```

## Monorepos (Turborepo / workspaces)

Keep a **root `AGENTS.md`** for repo-wide conventions (with the `CLAUDE.md`
symlink as above), then add a **scoped `AGENTS.md` in each workspace** that needs
its own rules — `apps/<app>/AGENTS.md`, `packages/<pkg>/AGENTS.md` — each with its
own sibling symlink created **from inside that directory** so the target is
relative:

```bash
cd apps/web && ln -s AGENTS.md CLAUDE.md   # CLAUDE.md -> ./AGENTS.md (same dir)
```

- Claude Code reads the **nearest** `CLAUDE.md` for the files it's working on, so
  nested files **supplement** the root rather than replace it. Put repo-wide
  things at the root; put only the package-specific delta in each workspace —
  don't duplicate the root.
- Always make each symlink **relative to its own folder** (`ln -s AGENTS.md
  CLAUDE.md` while `cd`'d into the workspace), never pointing back at the root —
  relative same-dir links survive checkout/move.
- Turborepo itself doesn't read these files (they're for agents), so **no
  `turbo.json` change is needed**. If you want them surfaced, you can still note
  the convention in the root `AGENTS.md`.

## README

If there's no `README.md`, scaffold a minimal one (project name, one-line
description, setup/run commands). Keep human-facing docs in `README.md` and
agent instructions in `AGENTS.md` — don't merge the two.

## Windows / CI caveat (important)

Git symlinks need `core.symlinks=true` and can break on Windows checkouts or
some CI runners (the symlink lands as a text file containing `AGENTS.md`). If the
project targets Windows, prefer the fallback: a tiny **real** `CLAUDE.md` whose
entire content is a pointer —

```markdown
See [AGENTS.md](./AGENTS.md) for project + agent instructions.
```

— accepting that it must be kept in sync manually (or via a check). Symlink is
better everywhere symlinks are reliable.

## Don't undo it later

If you see `CLAUDE.md` as a symlink to `AGENTS.md`, that's intentional — edit
`AGENTS.md`, never replace the symlink with a copy.

## AGENTS.md template

```markdown
# AGENTS.md

Instructions for AI agents and humans working in this repository.
`CLAUDE.md` is a symlink to this file; this file is the source of truth.

## Project overview
<what this is, in 1–3 sentences>

## Commands
- install: `…`
- dev: `…`
- build: `…`
- test / lint / format: `…`

## Conventions
- <code style, language/runtime, formatting>
- Commit messages: <e.g. Conventional Commits>
- <anything an agent must not do, or must always do>

## Layout
<key directories and what lives where>
```
