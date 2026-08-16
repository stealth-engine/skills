#!/usr/bin/env python3
"""Plan the slug-dir moves for a repo's git worktrees.

    worktree-slugs.py OLD_REPO NEW_REPO

For every linked worktree of OLD_REPO, prints one row:

    CLASS   MOVE        DEST      OLD_SLUG -> NEW_SLUG   PATH

  CLASS  inside  — the worktree lives under OLD_REPO, so its path changes with
                   the repo: its slug dir moves and its git admin files need repair.
         outside — the worktree path does NOT change: LEAVE its slug dir alone
                   (moving it orphans those sessions). It still needs repair,
                   because its pointer into the repo changed.
  MOVE   move-slug  — its slug dir exists and must be moved
         keep-slug  — leave it (outside worktree, or both slugs flatten alike)
         no-sessions— Claude Code never ran in this worktree, so there is no slug
                      dir to move. It still needs `git worktree repair`.
  DEST   absent  — destination slug free
         SAME    — destination is the source (identical slugs); do not move
         EXISTS  — STOP: another project may own it; slugs collide, so inspect
         COLLIDE — STOP: two of this repo's own worktrees flatten to one slug
                   (`wts/a_b` and `wts/a-b`), so their sessions already share a
                   directory. Sort that out by hand; do not move either.

Then prints the `inside` worktrees' NEW paths, one per line, for
`git worktree repair <path>...` after the move.

Reads `git worktree list --porcelain -z`: records are NUL-terminated, so paths
containing spaces OR newlines survive. A line-based pipeline does not — verified:
`git worktree list --porcelain | sed -n 's/^worktree //p'` reported a worktree
whose path contained a newline as a *different, truncated* path.

Both repo arguments are canonicalised with realpath before classification,
because git reports canonical paths and a symlinked or `..`-bearing argument
would otherwise misclassify the main worktree as external. Slugs are computed
from the paths git reports. If a session was started through a *symlinked* path,
Claude Code recorded the slug of the path as typed — check that one by hand with
claude-slug.py.

The trailing repair list is newline-separated for reading. If a path in it
contains a newline, pass that one to `git worktree repair` by hand.
"""

import os
import re
import subprocess
import sys


def slug(path: str) -> str:
    return re.sub(r"[^A-Za-z0-9]", "-", path)


def worktree_paths(repo: str) -> list[str]:
    out = subprocess.run(
        ["git", "-C", repo, "worktree", "list", "--porcelain", "-z"],
        capture_output=True,
        check=True,
    ).stdout
    paths = []
    for record in out.split(b"\0"):
        if record.startswith(b"worktree "):
            paths.append(record[len(b"worktree "):].decode("utf-8", "surrogateescape"))
    return paths


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    # realpath: git reports canonical paths, so comparing against an argument
    # carrying a symlink or ".." would classify the main worktree as external.
    old_repo, new_repo = (os.path.realpath(p) for p in argv)
    projects = os.path.expanduser("~/.claude/projects")

    try:
        paths = worktree_paths(old_repo)
    except subprocess.CalledProcessError as exc:
        print(f"FAILED: git worktree list on {old_repo}: "
              f"{exc.stderr.decode('utf-8', 'replace').strip()}", file=sys.stderr)
        return 1

    moved: list[str] = []
    stop = False
    seen_slugs: dict[str, str] = {}
    for path in paths:
        if path == old_repo:
            continue  # the main worktree — that is the repo move itself
        inside = path.startswith(old_repo + "/")
        new_path = new_repo + path[len(old_repo):] if inside else path
        old_slug, new_slug = slug(path), slug(new_path)

        if not os.path.lexists(os.path.join(projects, old_slug)):
            # never ran Claude Code here: nothing to move, but still repair it
            dest, move = "n/a", "no-sessions"
        elif old_slug in seen_slugs:
            # two of this repo's worktrees flatten to one slug: their sessions
            # already share a directory, so neither move is safe.
            dest, move = "COLLIDE", "STOP"
            stop = True
        elif old_slug == new_slug:
            dest, move = "SAME", "keep-slug"
        elif os.path.lexists(os.path.join(projects, new_slug)):
            # lexists, not isdir: a regular file or dangling symlink occupies
            # the destination just as surely as a directory does.
            dest, move = "EXISTS", "move-slug"
            stop = True
        else:
            dest, move = "absent", "move-slug"
        if not inside and dest not in ("COLLIDE", "n/a"):
            move = "keep-slug"
        seen_slugs.setdefault(old_slug, path)

        print(f"{'inside' if inside else 'outside':7} {move:10} {dest:7} "
              f"{old_slug} -> {new_slug}   {path}")
        if inside:
            moved.append(new_path)

    print()
    if moved:
        print("# repair after the move: git worktree repair <these paths>")
        for path in moved:
            print(path)
    else:
        print("# no worktrees move with the repo")
    if stop:
        print("\nSTOP: a destination slug is occupied, or two worktrees share one slug"
              " — inspect before moving anything", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
