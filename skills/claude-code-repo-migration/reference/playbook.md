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
BK=~/.claude/backups/repo-move-$(date +%Y%m%d-%H%M%S)   # inventory + backups land here
mkdir -p "$BK"

python3 "$SKILL/scripts/claude-slug.py" "$OLD_REPO" "$NEW_REPO"
```

The slug script prints `<slug>\t<exists|absent>\t<path>`. Set `OLD_SLUG` /
`NEW_SLUG` from its output — do not hand-roll the transform.

**If `OLD_SLUG` and `NEW_SLUG` come out identical**, the rename only changed
characters the slug flattens (`my_app` → `my-app`, say). The session dir is
already correct: skip every slug move below and change the registry only. Moving
a directory onto itself fails and would abort the chain.

## 1. Inventory (read-only — mutate nothing)

Destination must be clear. Both checks, separately:

```bash
if [ -e "$NEW_REPO" ]; then echo "STOP: $NEW_REPO exists"; else echo "repo dest clear"; fi
if [ "$OLD_SLUG" = "$NEW_SLUG" ]; then echo "slug unchanged — no slug move"
elif [ -e "$PROJ/$NEW_SLUG" ]; then echo "STOP: slug dest exists"
else echo "slug dest clear"; fi
```

The equal-slug arm comes first on purpose: when both paths flatten to the same
name, `$PROJ/$NEW_SLUG` **is** the source directory, so a bare existence check
would report a collision against itself and stop a migration that is fine.

A slug destination that exists for *different* slugs may belong to a **different**
project (separators all flatten to `-`, so distinct paths collide). Inspect before
deciding anything.

What is being moved, and what is being left behind:

```bash
ls -la "$(dirname "$OLD_REPO")"          # sibling repos you must NOT touch
ls -la "$PROJ/$OLD_SLUG"                 # transcripts, .wakatime, memory/, <uuid>/ dirs
ls -1 "$PROJ/$OLD_SLUG"/*.jsonl | wc -l  # session count — record it for verification
```

Every slug dir this repo owns beyond its own, derived from **real paths**, never
from slug-name prefixes. Record the plan — later steps need it:

```bash
python3 "$SKILL/scripts/worktree-slugs.py" "$OLD_REPO" "$NEW_REPO" | tee "$BK/worktree-plan.txt"
```

For each linked worktree it prints where it lives, whether its slug dir moves,
and whether the destination slug is free — then the list of paths to repair after
the move. It exits non-zero if any destination slug is occupied.

Read the classification, because the two halves need opposite treatment:

- **Inside `$OLD_REPO`** (e.g. `$OLD_REPO/.claude/worktrees/x`) — the path changes
  with the move, so its slug dir must move too, and its git admin files need repair.
- **Outside `$OLD_REPO`** (a sandbox or job tmp dir) — the path does **not** change,
  so its slug dir **stays exactly where it is**. Moving it would orphan those
  sessions. It still needs `git worktree repair`, because its pointer *into* the
  repo changed.

Do not hand-roll this from `git worktree list` output. A line-based pipeline
loses paths containing a newline — verified: `--porcelain | sed -n 's/^worktree
//p'` reported such a worktree as a *different, truncated* path, and
`awk '{print $2}'` truncates at a space as well. The script reads the `-z` form,
whose records are NUL-terminated.

Repo health, each on its own line:

```bash
git -C "$OLD_REPO" status --short > "$BK/status-before.txt"   # check THIS succeeded
wc -l < "$BK/status-before.txt"                               # then count — record it
git -C "$OLD_REPO" rev-parse HEAD            # record it
pgrep -af "next dev|vite|webpack|node .*dev"  # a dev server holding the tree open
pgrep -af "claude"                            # other live sessions — see the registry warning
```

`git status --short | wc -l` in one pipeline reports **0** when git fails, because
the pipeline's status is `wc`'s. Zero then reads as "clean tree" — and the
identical pipeline in step 5 fails the same way, so the two bogus counts agree
and the verification passes. Write the status, check that command, then count the
file.

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

Run these one at a time and **check each one's exit status** — every line here is
the thing you will need if the migration goes wrong:

```bash
cp -a "$PROJ/$OLD_SLUG" "$BK/projects-slug-backup"
cp -L ~/.claude.json "$BK/claude.json.bak"       # -L: follow the symlink, copy CONTENTS
readlink -f ~/.claude.json > "$BK/claude.json.realpath"   # note where it actually lives
git -C "$OLD_REPO" diff HEAD --binary > "$BK/uncommitted-tracked.patch"
git -C "$OLD_REPO" ls-files --others --exclude-standard -z > "$BK/untracked-list.z"
tar --null -C "$OLD_REPO" -T "$BK/untracked-list.z" -czf "$BK/untracked-files.tgz"
```

- **`cp -L`, never `cp -a`, for the registry.** `-a` implies `-d` and copies a
  symlink *as a symlink* (verified). A dotfile-managed `~/.claude.json` would then
  give you a "backup" that is a link to the live file the remapper rewrites —
  pointing at the post-migration state, with the original gone. Record the realpath
  too, so rollback can restore the link arrangement rather than flattening it.
- `diff HEAD --binary`, not bare `diff`: bare `git diff` omits **staged** changes
  and cannot carry binary content, so a plain patch silently loses both.
- The file list is written and checked **before** `tar` reads it. Piping
  `ls-files | tar` hands `tar` an empty list when `ls-files` fails, and it happily
  produces an empty archive and exits 0 — a backup that looks fine and holds nothing.

Then **prove the backup**, because `ls -la` only shows that files exist:

```bash
tar -tzf "$BK/untracked-files.tgz" | wc -l    # vs the untracked count you expect
python3 -c "import json,sys; json.load(open(sys.argv[1])); print('registry backup parses')" "$BK/claude.json.bak"
ls -1 "$BK/projects-slug-backup"/*.jsonl | wc -l   # == the session count from step 1
```

An unverified backup is not a backup. Back up each extra (worktree) slug dir the
same way before touching it.

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
- Drop the slug `mv` entirely when `OLD_SLUG` equals `NEW_SLUG` (see step 0).
- `rename()` preserves the inode, so a shell sitting in the repo follows it.
- Slug dirs for worktrees **inside** the repo move with their **own** `mv`, one per
  directory, each result checked — a loop would fold their statuses into one.
  Worktrees **outside** the repo keep their path: leave their slug dirs alone.
- **The chain stops; it does not undo.** If a later step fails, the earlier ones
  have already landed (registry repointed, slug moved) — go to step 7 and roll back
  the steps that succeeded before retrying.
- **Only if your own session is live inside the moved slug dir**, leave a
  compatibility symlink so its continued writes still land there:
  `ln -s -- "$NEW_SLUG" "$PROJ/$OLD_SLUG"`. Running from outside the repo makes
  this unnecessary; a stray symlink shows up later as a phantom project in the
  picker.

## 4. Repair the worktrees

The move invalidated absolute paths in `<repo>/.git/worktrees/<name>/gitdir` and
in each worktree's `.git` file.

Run it twice, because the two cases need different arguments. First, with no
arguments, to fix the worktrees that did **not** move (their `.git` file still
points at the repo's old location):

```bash
git -C "$NEW_REPO" worktree repair
```

Then, for the worktrees that moved *with* the repo, pass their **new** paths —
the repair list printed at the end of `$BK/worktree-plan.txt` (step 1). Pass them
as explicit quoted arguments. Do **not** glob `"$NEW_REPO"/.claude/worktrees/*`:
worktrees nested anywhere else are missed, and with no matches Bash hands `git` a
literal `*` and the command fails.

```bash
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
git -C "$NEW_REPO" status --short > "$BK/status-after.txt"   # check THIS succeeded
diff "$BK/status-before.txt" "$BK/status-after.txt"          # identical, not just equal counts
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

Replace the path **literally**. Do not reach for `sed`: both paths are
interpolated into a regex and a replacement, so `.` or `[` in `OLD_REPO` changes
what matches, and `&`, `\` or the `#` delimiter in `NEW_REPO` corrupts or breaks
the substitution. Nothing escapes them for you, and the failure is **silent** —
verified: with `OLD_REPO=/home/u/a.b[1]/repo` the `sed` form matched nothing and
left every transcript untouched while reporting success.

```bash
python3 - "$PROJ/$NEW_SLUG" "$OLD_REPO" "$NEW_REPO" <<'PY'
import glob, os, sys
d, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
for f in sorted(glob.glob(os.path.join(d, "*.jsonl"))):
    with open(f, encoding="utf-8", errors="surrogateescape") as fh:
        text = fh.read()
    if old not in text:
        continue
    tmp = f + ".tmp"
    with open(tmp, "w", encoding="utf-8", errors="surrogateescape") as fh:
        fh.write(text.replace(old, new))
    os.replace(tmp, f)
    print("rewrote", os.path.basename(f))
PY
```

Skip any file a live session owns (including your own, if you symlinked in step 3)
— remove it from the directory listing first, or move it aside.

## 7. Rollback

Everything needed is in `$BK`:

```bash
cp "$BK/claude.json.bak" "$(cat "$BK/claude.json.realpath")"   # write THROUGH the symlink
mv "$NEW_REPO" "$OLD_REPO"
mv "$PROJ/$NEW_SLUG" "$PROJ/$OLD_SLUG"
git -C "$OLD_REPO" worktree repair
```

Restore the registry to its **realpath** (step 2 recorded it), so a dotfile-managed
symlink keeps pointing where it did instead of being replaced by a plain file.

Rollback needs the same two-form worktree repair as step 4: the no-argument call
above fixes the worktrees that never moved, then repair the ones that moved back
with the repo by passing their restored **old** paths explicitly. Re-running
`worktree-slugs.py "$OLD_REPO" "$OLD_REPO"` lists them. Then prove it with
`git -C "<a worktree>" status --short`, the same as the forward path.

Then re-apply `uncommitted-tracked.patch` / untar `untracked-files.tgz` only if
the working tree actually lost them.
