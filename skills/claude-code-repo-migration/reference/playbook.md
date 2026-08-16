# Playbook — moving a repo and its Claude Code metadata

Commands for the procedure in [`../SKILL.md`](../SKILL.md). Read the rules there
first: the order (inventory → back up → confirm → mutate → verify), the slug rule,
and why the repo move goes **last**.

Every lookup below is its own command with its own result. Do not fold several
into one `if`/pipeline/`$(…)` — a folded exit status hides the one that failed,
and a failed lookup is missing evidence, never a negative result.

Concretely, the forms that keep reappearing and are banned here: **`something |
wc -l`** (the count is `wc`'s status — a failed `ls`/`git`/`tar` reports `0`,
which reads as "clean tree" / "no sessions" / "empty archive"), and **`cmd | tee
file`** (`tee`'s status hides a non-zero `cmd`, including a deliberate STOP exit).
Write the output to a file, check *that* command, then count or read the file.

Likewise **`[ -e X ]` follows symlinks**, so a dangling link reports the
destination as clear and the later `mv` fails after earlier steps have already
landed. Test `[ -e X ] || [ -L X ]` — the same reason the helper scripts use
`lexists` rather than `isdir`.

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
if [ -e "$NEW_REPO" ] || [ -L "$NEW_REPO" ]; then echo "STOP: $NEW_REPO exists"; else echo "repo dest clear"; fi
if [ "$OLD_SLUG" = "$NEW_SLUG" ]; then echo "slug unchanged — no slug move"
elif [ -e "$PROJ/$NEW_SLUG" ] || [ -L "$PROJ/$NEW_SLUG" ]; then echo "STOP: slug dest exists"
else echo "slug dest clear"; fi
```

The destination must also not live **inside** the source — `/projects/repo` →
`/projects/repo/archive/repo` is the shape to catch:

```bash
case "$NEW_REPO/" in "$OLD_REPO"/*) echo "STOP: destination is inside the source";; esac
```

`mkdir -p` would happily create that parent *within* the repo, and the `mv` then
refuses with `cannot move … to a subdirectory of itself` (verified) — but only
after the registry remap and the slug move have already landed, leaving the
metadata pointing at a path the repo never reached.

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
ls -1 "$PROJ/$OLD_SLUG" > "$BK/sessions-before.txt"   # NAMES, not paths — check THIS succeeded
wc -l < "$BK/sessions-before.txt"        # entry count — record it for verification
```

Every slug dir this repo owns beyond its own, derived from **real paths**, never
from slug-name prefixes. Record the plan — later steps need it:

```bash
python3 "$SKILL/scripts/worktree-slugs.py" "$OLD_REPO" "$NEW_REPO" > "$BK/worktree-plan.txt"
# check the exit status HERE — non-zero is the STOP signal — then read the plan:
cat "$BK/worktree-plan.txt"
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

**Before the repo's first commit**, `git rev-parse HEAD` exits 128 (`ambiguous
argument 'HEAD'`) and so does `git diff HEAD --binary` in step 2 — verified. That
is a legitimate state to migrate from: sessions can exist in a repo you never
committed. Record "unborn HEAD" instead of a SHA, and back the staged files up
with `git diff --cached --binary`, which works there (verified). `git status
--short` works either way.

`--cached` alone is not the whole picture: a file staged and then edited again
(`AM`) has a working-copy delta that the index diff doesn't carry, and the
untracked archive skips it because the path is now tracked. In an unborn repo take
**both** — `git diff --cached --binary` and `git diff --binary` — or archive the
tracked working copy outright.

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
python3 -c "import os;print(os.path.realpath(os.path.expanduser('~/.claude.json')))" \
  > "$BK/claude.json.realpath"                   # note where it actually lives
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
  and cannot carry binary content, so a plain patch silently loses both. In a repo
  with **no commits yet** this exits 128 — use `git diff --cached --binary` there.
- `python3 -c 'os.path.realpath'`, not `readlink -f`: `-f` is GNU, and stock
  macOS `readlink` has no such flag. Same portability class as `mv -T` above — and
  this one would abort the backup step before the migration even starts.
- The file list is written and checked **before** `tar` reads it. Piping
  `ls-files | tar` hands `tar` an empty list when `ls-files` fails, and it happily
  produces an empty archive and exits 0 — a backup that looks fine and holds nothing.
- **This archive is not everything the repo needs.** `--exclude-standard` honours
  `.gitignore`, so ignored-but-essential files — `.env`, `.env.local`, `.vercel`,
  service-account keys — are **not** in it, and they are exactly what step 5 tells
  you to check for afterwards. Copy the ones this repo actually has, by name, into
  `$BK` as a separate step. (Dropping `--exclude-standard` is not the answer: it
  would pull in `node_modules` and every build artefact.)

Then **prove the backup**, because `ls -la` only shows that files exist:

```bash
tar -tzf "$BK/untracked-files.tgz" > "$BK/untracked-listing.txt"   # check THIS succeeded
wc -l < "$BK/untracked-listing.txt"    # then count — vs the untracked count you expect
python3 -c "import json,sys; json.load(open(sys.argv[1])); print('registry backup parses')" "$BK/claude.json.bak"
ls -1 "$BK/projects-slug-backup"/*.jsonl > "$BK/backup-sessions.txt"   # check THIS succeeded
wc -l < "$BK/backup-sessions.txt"                  # == the session count from step 1
```

`tar -tzf … | wc -l` is the same trap as `git status | wc -l`: a missing or
corrupt archive gives pipeline status 0 and count 0, so the proof passes in
exactly the case it exists to catch.

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

**Never run `git worktree prune` before the repair.** Between the move and the
repair, git believes every moved worktree is gone — `worktree list` marks them
`prunable gitdir file points to non-existent location`, because it is still
looking at the *old* path. Pruning then deletes the admin entry for a worktree
that is perfectly fine, and **`git worktree repair` cannot rescue it afterwards**.

Verified end to end: after moving a repo containing `wts/one`, `prune` reported
`Removing worktrees/one: gitdir file points to non-existent location`, and the
follow-up repair failed with `unable to locate repository; .git file does not
reference a repository`. The files survive; the git linkage does not. Prune only
*after* a successful repair, and only for worktrees whose directory you have
confirmed is genuinely gone.

## 5. Verify

```bash
git -C "$NEW_REPO" status --short > "$BK/status-after.txt"   # check THIS succeeded
diff "$BK/status-before.txt" "$BK/status-after.txt"          # identical, not just equal counts
git -C "$NEW_REPO" rev-parse HEAD             # == the pre-move HEAD
if [ -e "$OLD_REPO" ] || [ -L "$OLD_REPO" ]; then echo "STOP: old repo still exists"; else echo "old repo gone"; fi
ls -la "$(dirname "$OLD_REPO")"               # siblings untouched
ls -1 "$PROJ/$NEW_SLUG" > "$BK/sessions-after.txt"    # check THIS succeeded
diff "$BK/sessions-before.txt" "$BK/sessions-after.txt"   # must be silent, status 0
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

Two things this has to get right, because it edits **serialised JSON** in place:

- **Replace the JSON-escaped form of each path, not the raw form.** A destination
  containing `"` or `\` — both legal in a POSIX path — has to land in the file
  *escaped*. Verified: a raw replacement with a quote-bearing path turns every
  line it touches into a `JSONDecodeError`, i.e. it destroys exactly the
  transcripts you are trying to preserve.
- **Preserve each file's mode.** A transcript can be `0600`; a temp file created
  under the usual umask is not. Verified: `0600` became `0664` under `umask 002`,
  exposing prompts and tool output to other local users on the machine.

```bash
python3 - "$PROJ/$NEW_SLUG" "$OLD_REPO" "$NEW_REPO" <<'PY'
import glob, json, os, stat, sys, tempfile
d, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
esc_old, esc_new = json.dumps(old)[1:-1], json.dumps(new)[1:-1]  # JSON-escaped forms
for f in sorted(glob.glob(os.path.join(d, "*.jsonl"))):
    with open(f, encoding="utf-8", errors="surrogateescape") as fh:
        text = fh.read()
    if esc_old not in text:
        continue
    mode = stat.S_IMODE(os.stat(f).st_mode)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(f) or ".", prefix=".rewrite")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", errors="surrogateescape") as fh:
            fh.write(text.replace(esc_old, esc_new))
        os.chmod(tmp, mode)
        os.replace(tmp, f)
    except BaseException:
        os.path.exists(tmp) and os.unlink(tmp)
        raise
    print("rewrote", os.path.basename(f))
PY
```

Replacing the escaped form also leaves every other byte of the file untouched,
which re-serialising the JSON would not.

Skip any file a live session owns (including your own, if you symlinked in step 3)
— remove it from the directory listing first, or move it aside.

## 7. Rollback

Everything needed is in `$BK`:

```bash
cp "$BK/claude.json.bak" "$(cat "$BK/claude.json.realpath")"   # write THROUGH the symlink
mv "$NEW_REPO" "$OLD_REPO"
# slug move ONLY if the slugs actually differ; delete the step-3 compatibility
# symlink at $PROJ/$OLD_SLUG first, if you created one
mv "$PROJ/$NEW_SLUG" "$PROJ/$OLD_SLUG"
git -C "$OLD_REPO" worktree repair
```

The slug `mv` is conditional for the same two reasons the forward path is: with
equal slugs it moves a directory onto itself, and if step 3 left the compatibility
symlink then `$PROJ/$OLD_SLUG` *is* a link to `$PROJ/$NEW_SLUG`, so the move
resolves to moving the directory into itself. Either way it fails and rollback
stops before the worktree repair. Check both, then move.

Restore the registry to its **realpath** (step 2 recorded it), so a dotfile-managed
symlink keeps pointing where it did instead of being replaced by a plain file.

**Reverse the worktree slug moves too.** Each one you moved in step 3 is still at
its new-path slug, and Claude Code will not find those sessions once the repo is
back at `$OLD_REPO`. Read the `old -> new` pairs out of `$BK/worktree-plan.txt`
(step 1) and `mv` each back, one at a time. Do **not** try to regenerate the
mapping by re-running `worktree-slugs.py "$OLD_REPO" "$OLD_REPO"`: both sides
would be old paths, so every row reports `SAME` and nothing gets reversed. The
forward plan is the only record of the pairing — which is why step 1 saves it.

Rollback also needs the same two-form worktree repair as step 4: the no-argument
call above fixes the worktrees that never moved, then repair the ones that moved
back by passing their restored **old** paths explicitly (the left-hand paths in
the plan file). Then prove it with `git -C "<a worktree>" status --short`, the
same as the forward path.

Then re-apply `uncommitted-tracked.patch` / untar `untracked-files.tgz` only if
the working tree actually lost them.

## 8. The repo was already moved (recovering after the fact)

This is the common way people arrive here: someone `mv`d the repo weeks ago, and
now the session picker is empty, the trust dialog is back, or the worktrees are
broken. Steps 1–3 assume `$OLD_REPO` still exists, so **do not run them** — every
lookup against the old path fails, and the chain would try to move a repo that is
already gone.

The metadata is untouched, which is what makes this recoverable: the slug dir is
still at `$OLD_SLUG` with every transcript in it, and the registry still has the
old key. You are doing the same remap **minus the repo move**.

**1. Recover the old path.** You cannot derive it from the slug — the flattening
is lossy. Two sources of evidence:

```bash
python3 - <<'PY'
import json, os
d = json.load(open(os.path.expanduser("~/.claude.json")))
for path in d.get("projects", {}):
    if not os.path.isdir(path):
        print("registry key with no directory:", path)
PY
```

Then confirm which one is *this* repo by reading a transcript in the orphaned slug
dir — here `cwd` is exactly the right evidence, because you are identifying the
path a session ran at, not deriving a slug from it:

```bash
python3 - "$HOME/.claude/projects/<OLD_SLUG>" <<'PY'
import glob, json, os, sys
for f in sorted(glob.glob(os.path.join(sys.argv[1], "*.jsonl")))[:1]:
    for line in open(f, encoding="utf-8", errors="replace"):
        o = json.loads(line)
        if isinstance(o, dict) and o.get("cwd"):
            print(f"{os.path.basename(f)}: cwd={o['cwd']}")
            break
PY
```

Cross-check that the candidate's slug is the dir you think it is
(`claude-slug.py`), and that its `githubRepoPaths` entry names the same repo.

**2. Set `OLD_REPO` to the recovered path and `NEW_REPO` to where the repo is
now**, then run the normal procedure with these differences:

- Step 1's inventory: run every `git` command against `$NEW_REPO`, not `$OLD_REPO`
  (`worktree-slugs.py "$NEW_REPO" "$NEW_REPO"` won't give you the old slugs — see
  below). Skip the "destination clear" check for the repo; it is already there.
- Step 2: back up the slug dir and the registry as written. There is no
  uncommitted-work snapshot to take at the old path.
- Step 3: run the registry remap and the slug `mv`, and **omit the repo `mv`**.
- Step 4: repair the worktrees from `$NEW_REPO` exactly as written.
- Step 5: verify as written.

**Worktree slugs in this case** come out of git's *stale* view, which is the
opposite of what you might expect. Until the repair runs, `git worktree list
--porcelain` from `$NEW_REPO` still reports each nested worktree at its **old**
path, flagged `prunable gitdir file points to non-existent location` — verified on
a moved fixture repo, where git reported `…/old/wts/one` while the directory
physically sat at `…/new/wts/one`.

So git hands you the old paths for free. Slug those directly, then rewrite the
`$OLD_REPO` prefix **to** `$NEW_REPO` to get the current paths — which are both
the new slugs and the explicit arguments `git worktree repair` needs:

```bash
git -C "$NEW_REPO" worktree list --porcelain -z   # paths here are the OLD ones
```

Do not try to rewrite `$NEW_REPO` back to `$OLD_REPO`; those strings are not in
git's output yet, so it would change nothing and you would recover no pairing.

Worktrees that were always outside the repo keep their path, so **their slug dir
needs nothing** — but they are **not** finished: their `.git` file still points at
`$OLD_REPO`, so they need the no-argument `git worktree repair` like every other
worktree. Only the Claude-side move is skipped, never the git-side repair.

**And do not prune first.** In exactly this state every moved worktree looks
prunable, and pruning destroys the linkage beyond what repair can fix — see the
warning in step 4. Repair, then prune if anything is still genuinely absent.

If the move was long ago, expect Claude Code to have been run at the new path
already. That produces **two** of everything, and neither may be merged blindly:

- **Two registry keys.** The remap script refuses rather than merge. Correct
  behaviour — decide by hand which entry's `allowedTools`/`mcpServers` to keep,
  delete the other key, then re-run.
- **Two slug dirs**, `$OLD_SLUG` (the history) and `$NEW_SLUG` (whatever has
  accumulated since). **Do not `mv` one onto the other**: with the destination
  present, `mv` puts the old slug directory *inside* the new one, where Claude
  Code will never look — a silent loss of exactly the history you came to rescue.
  Merge their **contents** instead: move the `<uuid>.jsonl` files, their
  `.wakatime` sidecars and `<uuid>/` directories across (uuids are unique, so
  they will not clash), then reconcile `memory/` by hand — both sides may hold a
  `MEMORY.md`. Remove the emptied old dir only once you have listed what moved.

This is the same collision the slug rule warns about, arriving from the other
direction: an occupied destination is a thing to inspect, never a thing to
overwrite.
