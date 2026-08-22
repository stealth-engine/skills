---
name: claude-code-repo-migration
description: "Move or rename a git repo on disk without losing its Claude Code history — remap the session dir (~/.claude/projects/<slug>/) and the ~/.claude.json projects key so every past session still resumes from the new path with trust, allowedTools and MCP servers intact, and repair the git worktrees the move breaks. Use when moving a repo to a different parent folder, renaming the org/parent directory, reorganising ~/projects, or after a move when: `claude --resume` shows no sessions / the session picker is empty at the new path, the trust dialog or project onboarding reappears, allowedTools or MCP servers were 'forgotten', auto-memory looks empty, or `git worktree list` / a worktree's git commands break. Covers the slug rule people get wrong (EVERY non-alphanumeric char becomes '-', not just '/'), which extra slug dirs a repo owns, backup-then-mutate ordering, and the fact that ~/.claude.json is live-rewritten by every running session."
metadata:
  author: stealth-factory
  co-author: wiiiimm
  version: "1.0.0"
---

# Move a repo without losing its Claude Code sessions

A plain `mv` of a repo works fine for git and breaks everything Claude Code keeps
*about* that repo. Nothing errors — the sessions simply stop appearing, the trust
dialog comes back, and the old transcripts sit in a directory nothing looks at
any more. This skill is the remap that makes the move invisible.

Commands live in [`reference/playbook.md`](./reference/playbook.md); three helpers
live in [`scripts/`](./scripts) — slug derivation, the worktree move plan, and the
registry remap. This body is the model and the rules.

## The three things, and only one of them is the repo

| # | Thing | Where | If you skip it |
| - | ----- | ----- | -------------- |
| 1 | The repo | `~/projects/<parent>/<repo>` | — |
| 2 | Session metadata | `~/.claude/projects/<SLUG>/` | every past session disappears from the picker; auto-memory goes with it |
| 3 | The home registry | `~/.claude.json` → `projects["<abs path>"]` | trust dialog + onboarding reappear; `allowedTools`, `mcpServers`, `mcpContextUris` are gone |

They are independent. Moving only the repo (2 and 3 left behind) is the common
accident — and it is silent.

**If the repo has already been moved**, which is how most people get here, the
forward procedure does not apply: it assumes the old path still exists and would
try to move a repo that is gone. Go to
[step 8 of the playbook](./reference/playbook.md) — the metadata is untouched, so
it is the same remap minus the repo move. Nothing is lost by having waited; the
slug dir still holds every transcript. Recover the old path by enumerating the
`projects` keys in `~/.claude.json` that no longer exist on disk, then confirm
which is this repo against a transcript's `cwd` — the one place that field is the
right evidence, since you are identifying a path rather than deriving a slug from
it. (Orphaned keys are common: the machine this was written on had eight, left by
an earlier move.)

**Do not `git worktree prune` in this state.** Every moved worktree looks
`prunable` to git until the repair runs, and pruning destroys linkage that repair
can no longer restore — verified.

The slug dir holds more than transcripts:

```text
~/.claude/projects/<SLUG>/
  <uuid>.jsonl            transcript          <uuid>/subagents/
  <uuid>.jsonl.wakatime   sidecar             <uuid>/tool-results/
  memory/                 auto-memory         <uuid>/remote-agents/
```

Count sessions with `*.jsonl`; **move or back up the whole directory** — the
per-session subdirectories are easy to miss with a glob.

## The slug rule (the one people get wrong)

**Every character outside `[A-Za-z0-9]` becomes `-`. Case is preserved.**

```text
/home/u/projects/my_app.v2   →  -home-u-projects-my-app-v2
/home/u/proj/repo/.claude/worktrees/x  →  -home-u-proj-repo--claude-worktrees-x
```

> Provenance: probed live on Claude Code 2.1.233 — a session started in
> `…/tmp/Slug_Test.dir with space` produced
> `-home-williamli--claude-jobs-…-tmp-Slug-Test-dir-with-space` (`_`, `.` and the
> space all became `-`; capitals survived). Independently confirmed by 4 real
> worktree slug dirs where `.claude` appears as `-claude`, and asserted against
> 15 existing path→slug pairs. Use [`scripts/claude-slug.py`](./scripts/claude-slug.py).

Four consequences:

- **`sed 's:/:-:g'` is wrong** for any path containing `.`, `_`, or a space — the
  common "is the new slug free?" precheck then passes vacuously against a name
  Claude Code will never read, and the move lands in a dead directory.
- **Slugs collide.** `my_app`, `my.app`, `my-app` and `my/app` all produce
  `my-app`. An occupied destination slug may belong to a *different* project —
  stop and look, never merge blindly.
- **A real rename can leave the slug unchanged.** `my_app` → `my-app` is a genuine
  move on disk that flattens to the same slug. Then the session dir is already
  right: change the registry key only, and do not move a directory onto itself.
- **Never derive the slug from a transcript's `cwd`.** Verified false on this
  machine: several worktree slug dirs hold transcripts whose first `cwd` is the
  main repo or even a *different* worktree. Derive from the path, not the file.

## Enumerate the slug dirs the repo owns — from real paths, never string prefixes

A repo with git worktrees owns **several** slug dirs, and they split by location:
only worktrees **inside** the repo change path when the repo moves, so only their
slug dirs move. A worktree parked **outside** the repo keeps its path, so its slug
dir must be left exactly where it is — moving it orphans those sessions (it still
needs a git repair, since its pointer *into* the repo changed).

[`scripts/worktree-slugs.py`](./scripts/worktree-slugs.py) does this
classification, computes each old→new slug, flags an occupied destination, and
emits the repair list. Do not hand-roll it from `git worktree list` text: a
line-based pipeline mangles a path containing a newline (verified — it reported a
*different, truncated* path), and splitting on whitespace truncates at a space.
The script reads the NUL-terminated `-z` form.

Do **not** collect them by prefix-matching slug names: because every separator
flattens to `-`, `-a-b-c` may be `/a/b/c`, `/a/b-c` or `/a/b.c`. A sibling
directory called `repo-name-extra` is indistinguishable from `repo/name/extra`,
so a prefix sweep can drag in another project's sessions.

## Order of operations — inventory → back up → confirm → mutate → verify

1. **Inventory read-only.** Destination path clear; destination slug(s) clear;
   session count; worktree list; uncommitted work; the exact set of `~/.claude.json`
   references (keys *and* values — there is usually more than one).
2. **Back up before mutating anything**: the whole slug dir, `~/.claude.json`, and
   any uncommitted/untracked work.
3. **Confirm the plan with the user** — old path, new path, session count, the
   worktrees affected, and which sibling repos you are *not* touching.
4. **Mutate as one `&&` chain with the repo move LAST.** Any earlier failure then
   aborts while the repo is still where everyone expects it. (`rename()` keeps the
   inode, so an open shell's cwd follows the repo.)
5. **Verify** (below) — and treat a failed check as unfinished work, not noise.

**Run this from outside the repo being moved** (e.g. from `$HOME`). Then no
session in the slug dir is live, and the move is a clean rename. If you are
running *inside* it, your own session is live in that slug — symlink the old slug
name at the new one as a hedge, and never rewrite a transcript that is being
appended to.

## `~/.claude.json` is a live file — atomic is not enough

Every running Claude Code process reads and rewrites it. Verified: with 5 `claude`
processes up, the file's mtime was **17 seconds old**. A temp-file + `os.replace`
prevents a *torn* file; it does not prevent a **lost update** — another session
that loaded the JSON before your write will happily save its version over yours.

So: do the registry edit with **no other sessions running**, and re-check
afterwards that your rename survived.

What the entry carries (verified field names): `hasTrustDialogAccepted`,
`hasCompletedProjectOnboarding`, `allowedTools`, `mcpServers`,
`enabledMcpjsonServers`/`disabledMcpjsonServers`, `mcpContextUris`,
`hasClaudeMdExternalIncludesApproved`, `lastSessionId`, plus usage stats.

The old path also appears **outside** `projects` — most often as values in
`githubRepoPaths["<org>/<repo>"]`, which is a list of local checkout paths. Fix
those *values*; the `<org>/<repo>` **keys** are GitHub identifiers, not paths.
Same for the git remote: `git@github.com:<org>/<repo>.git` may contain the old
parent name and must **never** be rewritten. Only ever replace a **full absolute
local path**, anchored — never a bare folder or org substring.

Use [`scripts/remap-claude-json.py`](./scripts/remap-claude-json.py): it repoints
keys and values that are exactly `OLD` or live under `OLD/`, refuses on a
destination-key collision, refuses to write if any anchored reference would
survive, and is **dry-run unless `--apply`**.

## Git worktrees break — and `git worktree repair` is the fix

Worktrees store absolute paths in **both** directions (verified on git 2.43.0):

- `<repo>/.git/worktrees/<name>/gitdir` → absolute path of the worktree's `.git` file
- `<worktree>/.git` → `gitdir: <abs path into the repo's .git/worktrees/<name>>`

Moving the repo invalidates both, so git commands in the worktree fail. After the
move, run `git worktree repair` from the moved repo, and pass the worktree paths
explicitly when the worktrees moved too. Worktrees that live **outside** the repo
(a sandbox/job tmp dir, for example) do not move with it — they still need the
repair because the pointer *into* the repo changed.

Prune first if some are already dead: `git worktree prune` — but only after
confirming nothing uncommitted lives in them.

## What not to touch, and why

| Path | Why |
| ---- | --- |
| `~/.claude/sessions/<pid>.json` | live, pid-scoped; superseded on next launch — editing is racy and pointless |
| `~/.claude/history.jsonl` | one global prompt history across all projects; old paths there are cosmetic |
| `~/.claude/file-history/<session-uuid>/…` | edit-undo snapshots, **session**-scoped not project-scoped, so they don't follow the slug dir. Old-path hits here are **normal** — do not "fix" them |
| the git remote | a GitHub identifier, not a filesystem path |
| `/tmp/claude-*` | ephemeral, recomputed from cwd |

Grep the rest of `~/.claude` rather than trusting any list of directory names —
the layout moves between versions (`todos/` is in older runbooks and is absent on
2.1.233). Investigate hits; expect them to be few.

## Verify (each check independently — a failed lookup is missing evidence)

- `git status --short` count and `git rev-parse HEAD` match the pre-move values.
- The old repo path no longer exists; sibling repos in the old parent are untouched.
- Every expected `*.jsonl` is present at the **new** slug, and `memory/` came with it.
- `~/.claude.json`: new key present, old key gone, `hasTrustDialogAccepted` still true.
- `git worktree list` resolves, and a git command *inside* a worktree succeeds.
- Launch `claude` from the new path once: the picker lists the old sessions and no
  trust dialog appears.

Resume is **cwd-scoped** — `claude --resume <uuid>` finds a session only from the
directory whose slug owns it. Hand the user the new path, not just the uuid.

**Rewriting old paths inside transcripts is optional.** It only makes stale
`file:line` refs in old scrollback clickable again. Evidence it is unnecessary: a
slug dir on this machine was renamed by an earlier migration and its transcripts
still carry the pre-move `cwd` — sessions resume fine. If you do it, only ever
touch files no live session is appending to.

## Preconditions and portability

- **Same filesystem for `OLD_REPO` and `NEW_REPO`** — that is the move whose
  atomicity is at stake. (The slug dirs are siblings inside `~/.claude/projects`,
  so that rename is always same-device; the repo-vs-`~/.claude` comparison is
  irrelevant.) Across filesystems `mv` still copies, but open fds won't follow — do
  it with nothing live in the slug and skip the symlink hedge.
- **Every slug starts with `-`**, so `ls`, `mv`, `cp` and `rm` read a bare slug as
  a flag. Always use absolute paths, `./`, or `--`.
- `mv -T` is a **GNU coreutils** flag (9.4 here) and is the same portability class
  as the `timeout` gotcha in this repo's AGENTS.md — on a BSD/macOS `mv` it fails.
  The destination-is-clear precheck already rules out the "moved *into* an existing
  directory" trap that `-T` guards, so plain `mv` is the portable form.
- Needs `python3` (3.12 here), `git`, `tar`, and write access to `~/.claude`.

> Environment stamp: facts above were verified on **Claude Code 2.1.233**, **git
> 2.43.0**, GNU coreutils 9.4, Linux. They are compatibility notes about a moving
> target, not a promise about the machine you are on — re-probe the slug rule and
> the `~/.claude` layout before trusting them.
