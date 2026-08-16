# Playbook — moving a repo and its Claude Code metadata

Commands for the procedure in [`../SKILL.md`](../SKILL.md). Read the rules there
first: the order (inventory → back up → confirm → mutate → verify), the slug rule,
and why the repo move goes **last**.

Every lookup below is its own command with its own result. Do not fold several
into one `if`/pipeline/`$(…)` — a folded exit status hides the one that failed,
and a failed lookup is missing evidence, never a negative result.

Run this **from outside the repo being moved** (e.g. `cd ~`) whenever you can.

## 0. Variables

```bash
SKILL=~/.claude/skills/claude-code-repo-migration        # wherever this skill is installed
OLD_REPO=/home/USER/projects/OLD_PARENT/REPO             # fill in — absolute, no trailing /
NEW_REPO=/home/USER/projects/NEW_PARENT/REPO             # fill in
PROJ=~/.claude/projects

python3 "$SKILL/scripts/claude-slug.py" "$OLD_REPO" "$NEW_REPO"
```

The slug script prints `<slug>\t<exists|absent>\t<path>`. Set `OLD_SLUG` /
`NEW_SLUG` from its output — do not hand-roll the transform.

## 1. Inventory (read-only — mutate nothing)

Destination must be clear. Both checks, separately:

```bash
if [ -e "$NEW_REPO" ]; then echo "STOP: $NEW_REPO exists"; else echo "repo dest clear"; fi
if [ -e "$PROJ/$NEW_SLUG" ]; then echo "STOP: slug dest exists"; else echo "slug dest clear"; fi
```

A slug destination that exists may belong to a **different** project (separators
all flatten to `-`, so distinct paths collide). Inspect before deciding anything.

What is being moved, and what is being left behind:

```bash
ls -la "$(dirname "$OLD_REPO")"          # sibling repos you must NOT touch
ls -la "$PROJ/$OLD_SLUG"                 # transcripts, .wakatime, memory/, <uuid>/ dirs
ls -1 "$PROJ/$OLD_SLUG"/*.jsonl | wc -l  # session count — record it for verification
```

Every slug dir this repo owns, derived from **real paths**, never from slug-name
prefixes:

```bash
git -C "$OLD_REPO" worktree list --porcelain | awk '/^worktree /{print $2}'
```

Feed those paths to `claude-slug.py` — the ones marked `exists` are extra slug
dirs that must move too.

Repo health, each on its own line:

```bash
git -C "$OLD_REPO" status --short | wc -l    # record it
git -C "$OLD_REPO" rev-parse HEAD            # record it
git -C "$OLD_REPO" worktree list             # note which worktrees are inside vs outside the repo
pgrep -af "next dev|vite|webpack|node .*dev"  # a dev server holding the tree open
pgrep -af "claude"                            # other live sessions — see the registry warning
```

Every `~/.claude.json` reference, keys and values (the dry run *is* the inventory):

```bash
python3 "$SKILL/scripts/remap-claude-json.py" "$OLD_REPO" "$NEW_REPO"
```

Anywhere else under `~/.claude` that mentions the old path — grep the directory
rather than trusting a list of names, and investigate every hit:

```bash
grep -rl -- "$OLD_REPO" ~/.claude 2>/dev/null | sed "s#^$HOME/.claude/##" | cut -d/ -f1 | sort | uniq -c
```

Hits under `projects/` are expected (transcripts record their `cwd`). Hits under
`file-history/` are expected and are **not** to be fixed — see the SKILL body.
Hits under `plugins/` are typically a third-party plugin's content-hashed cache
(observed: `claude-hud/transcript-cache`, `config-cache`) — regenerated, leave
them. `backups/` hits are your own earlier snapshots. What you are hunting for is
a hit somewhere you cannot explain.

**Now confirm the plan with the user**: old path, new path, session count, the
worktrees affected, the sibling repos being left alone, and whether any other
`claude` process is running.

## 2. Back up (mutates nothing you care about)

```bash
BK=~/.claude/backups/repo-move-$(date +%Y%m%d-%H%M%S)
mkdir -p "$BK"
cp -a "$PROJ/$OLD_SLUG" "$BK/projects-slug-backup"
cp -a ~/.claude.json "$BK/claude.json.bak"
git -C "$OLD_REPO" diff > "$BK/uncommitted-tracked.patch"
git -C "$OLD_REPO" ls-files --others --exclude-standard -z \
  | tar --null -C "$OLD_REPO" -T - -czf "$BK/untracked-files.tgz"
ls -la "$BK"
```

Back up each extra (worktree) slug dir the same way before touching it.

## 3. Mutate — one `&&` chain, repo move LAST

Anything that fails aborts the chain while the repo is still where everyone
expects it, which is trivially recoverable.

```bash
python3 "$SKILL/scripts/remap-claude-json.py" "$OLD_REPO" "$NEW_REPO" --apply \
&& mv "$PROJ/$OLD_SLUG" "$PROJ/$NEW_SLUG" \
&& mkdir -p "$(dirname "$NEW_REPO")" \
&& mv "$OLD_REPO" "$NEW_REPO" \
&& echo "MOVE OK"
```

Notes:

- Plain `mv src dst` renames only because step 1 proved `dst` does not exist —
  re-check immediately before running. (`mv -T` guards that case explicitly but is
  a GNU coreutils flag; it is not on a stock macOS/BSD `mv`.)
- `rename()` preserves the inode, so a shell sitting in the repo follows it.
- Extra slug dirs (worktrees) move with their **own** `mv`, one per directory,
  each result checked — a loop would fold their statuses into one.
- **Only if your own session is live inside the moved slug dir**, leave a
  compatibility symlink so its continued writes still land there:
  `ln -s -- "$NEW_SLUG" "$PROJ/$OLD_SLUG"`. Running from outside the repo makes
  this unnecessary; a stray symlink shows up later as a phantom project in the
  picker.

## 4. Repair the worktrees

The move invalidated absolute paths in `<repo>/.git/worktrees/<name>/gitdir` and
in each worktree's `.git` file.

```bash
git -C "$NEW_REPO" worktree repair                      # worktrees that did NOT move
git -C "$NEW_REPO" worktree repair "$NEW_REPO"/.claude/worktrees/*   # ones that moved with the repo
git -C "$NEW_REPO" worktree list
```

Then prove it, per worktree — `worktree list` printing a path is not proof that
git works inside it:

```bash
git -C "<a worktree path>" status --short
```

`git worktree prune` removes entries whose directory is genuinely gone — run it
only after confirming nothing uncommitted lives there.

## 5. Verify

```bash
git -C "$NEW_REPO" status --short | wc -l     # == the pre-move count
git -C "$NEW_REPO" rev-parse HEAD             # == the pre-move HEAD
if [ -e "$OLD_REPO" ]; then echo "STOP: old repo still exists"; else echo "old repo gone"; fi
ls -la "$(dirname "$OLD_REPO")"               # siblings untouched
ls -1 "$PROJ/$NEW_SLUG"/*.jsonl | wc -l       # == the pre-move session count
ls -la "$PROJ/$NEW_SLUG/memory"               # auto-memory came along
```

Untracked, git-invisible files that a build needs (`.env`, `.env.local`,
`.vercel`, `node_modules`) — check the ones this repo actually has.

Registry:

```bash
python3 - "$NEW_REPO" "$OLD_REPO" <<'PY'
import json, os, sys
new, old = sys.argv[1], sys.argv[2]
d = json.load(open(os.path.expanduser("~/.claude.json")))
p = d["projects"]
print("new key present:", new in p, "| old key gone:", old not in p)
e = p.get(new, {})
print("trust:", e.get("hasTrustDialogAccepted"),
      "| onboarded:", e.get("hasCompletedProjectOnboarding"),
      "| allowedTools:", len(e.get("allowedTools", [])))
PY
```

If another session was running during step 3, re-run this check a minute later —
a concurrent process can save its stale copy over your rename.

Finally, launch `claude` from `$NEW_REPO` once: the old sessions appear in the
picker and no trust dialog shows. That is the actual acceptance test.

## 6. Optional — make old scrollback clickable again

Only cosmetic, and only safe for sessions that have **ended** (nothing is
appending). It rewrites the old absolute path inside transcripts so `file:line`
references resolve at the new location.

```bash
for f in "$PROJ/$NEW_SLUG"/*.jsonl; do
  sed "s#$OLD_REPO#$NEW_REPO#g" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
done
```

Skip any file a live session owns (including your own, if you symlinked in step 3).

## 7. Rollback

Everything needed is in `$BK`:

```bash
cp -a "$BK/claude.json.bak" ~/.claude.json
mv "$NEW_REPO" "$OLD_REPO"
mv "$PROJ/$NEW_SLUG" "$PROJ/$OLD_SLUG"
git -C "$OLD_REPO" worktree repair
```

Then re-apply `uncommitted-tracked.patch` / untar `untracked-files.tgz` only if
the working tree actually lost them.
