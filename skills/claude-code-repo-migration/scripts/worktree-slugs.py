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
  MOVE   move-slug / keep-slug (keep also when both slugs flatten to the same name)
  DEST   absent  — destination slug free
         SAME    — destination is the source (identical slugs); do not move
         EXISTS  — STOP: another project may own it; slugs collide, so inspect

Then prints the `inside` worktrees' NEW paths, one per line, for
`git worktree repair <path>...` after the move.

Reads `git worktree list --porcelain -z`: records are NUL-terminated, so paths
containing spaces OR newlines survive. A line-based pipeline does not — verified:
`git worktree list --porcelain | sed -n 's/^worktree //p'` reported a worktree
whose path contained a newline as a *different, truncated* path.

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
    old_repo, new_repo = (p.rstrip("/") for p in argv)
    projects = os.path.expanduser("~/.claude/projects")

    try:
        paths = worktree_paths(old_repo)
    except subprocess.CalledProcessError as exc:
        print(f"FAILED: git worktree list on {old_repo}: "
              f"{exc.stderr.decode('utf-8', 'replace').strip()}", file=sys.stderr)
        return 1

    moved: list[str] = []
    stop = False
    for path in paths:
        if path == old_repo:
            continue  # the main worktree — that is the repo move itself
        inside = path.startswith(old_repo + "/")
        new_path = new_repo + path[len(old_repo):] if inside else path
        old_slug, new_slug = slug(path), slug(new_path)

        if old_slug == new_slug:
            dest, move = "SAME", "keep-slug"
        elif os.path.isdir(os.path.join(projects, new_slug)):
            dest, move = "EXISTS", "move-slug"
            stop = True
        else:
            dest, move = "absent", "move-slug"
        if not inside:
            move = "keep-slug"

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
        print("\nSTOP: a destination slug already exists — inspect before moving anything",
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
