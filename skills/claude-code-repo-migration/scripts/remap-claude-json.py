#!/usr/bin/env python3
"""Repoint ~/.claude.json from an OLD repo path to a NEW one.

    remap-claude-json.py OLD_ABS NEW_ABS            # dry run: prints every change
    remap-claude-json.py OLD_ABS NEW_ABS --apply    # writes atomically

What it changes: every dict KEY and string VALUE, at any depth, that is exactly
OLD or lives under OLD/ — the `projects` entry (trust, allowedTools, mcpServers)
and any nested worktree entries, plus local-checkout paths such as the lists
under `githubRepoPaths`.

What it leaves alone: anything not anchored at OLD. `githubRepoPaths` KEYS are
`<org>/<repo>` identifiers, not absolute paths, so they never match. Matching is
boundary-anchored, so a sibling path like OLD + "-backup" is untouched.

Safety: refuses on a destination-key collision, refuses to write if any anchored
OLD reference would survive, and replaces the file atomically (temp file in the
same directory + os.replace).

NOTE: ~/.claude.json is rewritten by every running Claude Code process. Atomic
replacement prevents a torn file, NOT a lost update — run this with no other
sessions live, then re-check that the rename survived.
"""

import json
import os
import sys
import tempfile


def main(argv: list[str]) -> int:
    apply_changes = "--apply" in argv
    positional = [a for a in argv if a != "--apply"]
    if len(positional) != 2:
        print(__doc__.strip(), file=sys.stderr)
        return 2

    old, new = (p.rstrip("/") for p in positional)
    if not old.startswith("/") or not new.startswith("/"):
        print("REFUSING: both paths must be absolute", file=sys.stderr)
        return 1
    if old == new:
        print("REFUSING: OLD and NEW are the same path", file=sys.stderr)
        return 1

    # realpath: a dotfile-managed ~/.claude.json is often a symlink, and os.replace
    # on the link path would swap the link itself for a regular file.
    registry = os.path.realpath(os.path.expanduser("~/.claude.json"))
    with open(registry, encoding="utf-8") as fh:
        data = json.load(fh)

    changes: list[str] = []

    def anchored(value: object) -> bool:
        return isinstance(value, str) and (value == old or value.startswith(old + "/"))

    def repoint(value: str) -> str:
        return new + value[len(old):]

    def convert(node: object, where: str) -> object:
        if isinstance(node, dict):
            out: dict = {}
            for key, value in node.items():
                new_key = repoint(key) if anchored(key) else key
                if new_key != key:
                    if new_key in node or new_key in out:
                        raise SystemExit(
                            f"REFUSING: {where}[{new_key!r}] already exists — "
                            "another project owns it; merge by hand"
                        )
                    changes.append(f"{where}: key {key!r} -> {new_key!r}")
                out[new_key] = convert(value, f"{where}.{new_key}")
            return out
        if isinstance(node, list):
            return [convert(item, f"{where}[{i}]") for i, item in enumerate(node)]
        if anchored(node):
            assert isinstance(node, str)
            replacement = repoint(node)
            changes.append(f"{where}: {node!r} -> {replacement!r}")
            return replacement
        return node

    data = convert(data, "root")

    survivors: list[str] = []

    def audit(node: object, where: str) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                if anchored(key):
                    survivors.append(f"{where} key {key!r}")
                audit(value, f"{where}.{key}")
        elif isinstance(node, list):
            for i, item in enumerate(node):
                audit(item, f"{where}[{i}]")
        elif anchored(node):
            survivors.append(where)

    audit(data, "root")
    if survivors:
        print("REFUSING: OLD references survived the transform:", file=sys.stderr)
        for s in survivors:
            print(f"  {s}", file=sys.stderr)
        return 1

    for line in changes:
        print(line)
    print(f"{len(changes)} change(s)")

    if not apply_changes:
        print("dry run — nothing written; re-run with --apply")
        return 0
    if not changes:
        print("nothing to write")
        return 0

    payload = json.dumps(data, indent=2) + "\n"
    mode = os.stat(registry).st_mode & 0o777
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(registry) or ".", prefix=".claude.json.tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(payload)
            fh.flush()
            os.fsync(fh.fileno())
        os.chmod(tmp, mode)
        os.replace(tmp, registry)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    print(f"wrote {registry} atomically; 0 anchored OLD references remain")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
