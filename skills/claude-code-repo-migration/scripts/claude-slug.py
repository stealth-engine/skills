#!/usr/bin/env python3
"""Print the ~/.claude/projects slug for each path given, and whether it exists.

    claude-slug.py /home/u/projects/new-parent/repo [more paths...]
    -home-u-projects-new-parent-repo	absent	/home/u/projects/new-parent/repo

The rule: every character outside [A-Za-z0-9] becomes '-'; case is preserved.
Not just '/' — '.', '_' and spaces flatten too, which is why a hand-rolled
`sed 's:/:-:g'` computes a name Claude Code will never read.

Pass the path as Claude Code sees it (what `pwd` prints in that directory).
Symlinks are deliberately NOT resolved.
"""

import os
import re
import sys


def slug(path: str) -> str:
    return re.sub(r"[^A-Za-z0-9]", "-", path)


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    projects = os.path.expanduser("~/.claude/projects")
    for raw in argv:
        path = os.path.abspath(os.path.expanduser(raw))
        name = slug(path)
        state = "exists" if os.path.isdir(os.path.join(projects, name)) else "absent"
        print(f"{name}\t{state}\t{path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
