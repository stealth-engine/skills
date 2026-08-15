---
name: git-trunk-branch-and-pr-automation
description: "Trunk-based Git workflow with enforced branch naming and squash-merge PR titles, including how stacked PRs fit it. Use when setting up or standardising a branch/PR workflow, naming branches (feature/ fix/ hotfix/ and AI-agent prefixes claude/ cursor/ codex/ copilot/ codegen-bot/ dependabot/), configuring squash-only merges where the PR title becomes the commit and the body is the concatenated commits, making the PR title a valid Conventional Commit, adding GitHub Actions that validate branch names or auto-normalise PR titles, fixing a PR-title bot that loops, or deciding trunk vs release branches. Also use for stacked / dependent PRs — GitHub's native stacks (gh stack), Graphite (gt) or Cursor Origin — when stack layers fail branch-name checks, CI cost multiplies across a stack, a workflow condition on base.ref stops matching, gh pr merge fails on a stack, or you need github.event.pull_request.stack metadata. Covers the GitHub repo settings, the validation/normalisation workflows, and how it feeds semantic-release."
metadata:
  author: stealth-factory
  co-author: wiiiimm
  version: "1.3.0"
---

# Trunk-based branches + squash-PR automation

A trunk-based workflow where every change is a short-lived branch off `main`,
merged via **squash** with a **Conventional Commit PR title**. That title becomes
the single commit on `main` that [semantic-release](../semantic-release-automation/SKILL.md)
reads — so naming and title hygiene aren't cosmetic, they drive the release.

Templates: [`templates/`](./templates) — branch-name validation, the PR-title
normaliser workflow, and the shared `normalize-pr-title.js`.

## The model

- **Trunk-based:** branch off `main`, keep PRs small, merge frequently; `main`
  stays releasable. Don't use long-lived `develop`/release branches unless you must
  stabilise a release while trunk moves on, or support multiple live versions.
- **Branch naming:** `feature/<desc>`, `fix/<desc>`, `hotfix/<desc>` — plus
  **AI-agent prefixes** `claude/ cursor/ codex/ copilot/ codegen-bot/ dependabot/`
  for agent- and bot-authored branches. Validated by
  [`branch-name-check.yml`](./templates/branch-name-check.yml).

## Squash merge: the PR title *is* the commit

Configure the repo so a merge collapses to one clean, semantic commit:

- **GitHub → Settings → General → Pull Requests:** enable **Squash merging only**
  (turn off merge commits and rebase). Set **"Default commit message" →
  "Pull request title and commit details"** — GitHub then uses the **PR title as the
  squash subject** (it appends `(#<PR-number>)`, which doesn't affect Conventional
  Commit parsing) and **concatenates the PR's commit messages into the body**.
- So: the **title** must be a valid Conventional Commit (it's what semantic-release
  analyses → version + changelog); the **body** (the concatenated commits) preserves
  the detailed history.
- Keep a PR to **one logical change** (in a monorepo, one package) so the single
  squashed commit maps cleanly to one type+scope. See
  [`conventional-commits`](../conventional-commits/SKILL.md).

## PR-title automation

[`pr-title-manager.yml`](./templates/pr-title-manager.yml) +
[`normalize-pr-title.js`](./templates/normalize-pr-title.js) keep the title valid:

- On open/reopen/synchronize it normalises the title to Conventional Commits
  (lowercasing the type, or synthesising `<type>: <subject>` from the PR's commits
  / branch prefix when the title isn't conventional).
- A correct title is left untouched; the **`skip-title-automation` label** opts out of
  the auto-rewrite for the rare edge case (still validated — see
  [Opting out](#opting-out-of-the-auto-rewrite) below).
- It posts a **sticky comment** explaining the squash convention.
- Install the script at `.github/scripts/normalize-pr-title.js`; the workflow
  `sparse-checkout`s the `.github/scripts` directory to load it.

Pair it with `branch-name-check.yml`, and in **branch protection** require both
checks (plus your release/CI checks) before a PR can merge.

### Opting out of the auto-rewrite

There are two cases — and the **first covers almost everyone**:

1. **Just write a valid Conventional Commit title.** The normaliser only rewrites a
   title that *isn't* already conventional; a correct title (`feat: add x`,
   `fix(api): …`) is left **completely untouched**. There's nothing to "skip" — this
   is the intended path.
2. **Add the `skip-title-automation` label** (create it once in the repo) only for the
   rare case where the title isn't conventional *yet* and you don't want the bot
   auto-editing it / posting its comment while you sort it out (e.g. mid-review). The
   label suppresses the **auto-rewrite + sticky comment** — but **not validation**: the
   required check still **fails** until the title is a valid Conventional Commit (or a
   `type!:` breaking commit is reflected by a `!`). So the label changes *who* fixes
   the title (you, not the bot), never *whether* it must be valid before merge.

The opt-out is a **label, not a string in the title**, on purpose: the PR title becomes
the squash commit semantic-release reads, so any marker left in the title would land in
the release commit and silently produce **no release**. The label is also ignored on
the fork/bot validate path (it never edits there, so there's nothing to suppress).

## Stacked PRs — the other shape a trunk workflow can take

Stacking is now first-class: **GitHub native** (public preview 2026-07-30, `gh stack`),
**Graphite** (`gt`), and **Cursor Origin**. A stack is a chain of branches where each PR's
base is the layer below it, and the chain lands on `main`. It's still trunk-based — the
same short-lived-branch, squash-to-`main` model — just decomposed. Agents produce many
small dependent changes, so expect more of it.

**Don't learn the CLI from this skill — install the vendor's:**

| Tool | Agent skill | CLI |
| --- | --- | --- |
| GitHub | `gh skill install github/gh-stack` | `gh extension install github/gh-stack` |
| Graphite | [`withgraphite/agent-skills`](https://github.com/withgraphite/agent-skills) → `skills/graphite/SKILL.md` | `gt` |

Stacked PRs need **`gh` ≥ 2.90.0** (GitHub's stated minimum). `gh skill` is a **newer
subcommand than the extension** — it's absent on older builds (verified missing on
2.45.0, where `gh extension install` still works fine). Check `gh --version` before
telling anyone to run either.

Those skills cover the CLI thoroughly and **neither mentions Actions, webhooks,
Conventional Commits, or branch-name policy at all**. That gap is this skill's job:

### 1. Branch names — mostly fine, two real breaks

`gh stack` uses names **verbatim** (slashes allowed), so `gh stack add feature/auth`
passes [`branch-name-check.yml`](./templates/branch-name-check.yml) unchanged. Two forms
don't, verified against the actual regex:

```text
PASS  feature/auth              ← name layers explicitly; nothing to change
FAIL  03-24-add_login           ← `gh stack add -Am "..."` auto-naming (date+slug)
FAIL  auth-bugfix/reorder-args  ← Graphite's *documented* convention
```

So: **name each layer with a valid prefix** (`feature/auth-layer`, `feature/auth-api`),
or extend the regex if you adopt Graphite's `stack-name/change-name` convention.

### 2. CI runs for **every** PR in the stack — a 5-layer stack is 5× the CI

Actions evaluates workflow triggers against the **stack's base branch**, so
`on: pull_request: branches: [main]` fires for every layer — no workflow changes needed,
but the cost multiplies. Gate expensive jobs with `github.event.pull_request.stack` —
which is **`null` on a standalone PR**, so the null branch must **admit** the PR, not
exclude it:

```yaml
# standalone PR, OR the lowest unmerged layer (its own base IS the stack base)
if: github.event.pull_request.stack == null ||
    github.event.pull_request.stack.base.ref == github.event.pull_request.base.ref
# standalone PR, OR the top layer (carries the full set of changes)
if: github.event.pull_request.stack == null ||
    github.event.pull_request.stack.position == github.event.pull_request.stack.size
```

⚠️ **Write it as `== null || …`, never `!= null && …`.** GitHub's own docs show the
`!= null &&` form on illustrative `echo` *steps*, where skipping non-stacked PRs is the
point. Lift that same condition onto a **job** and every ordinary PR in the repo silently
stops running it — a required check that never runs, on the normal path, for a feature
most PRs don't even use. Invert the null case so standalone PRs always run and only
*upper stack layers* are skipped.

Fields: `stack.{id,number,size,position,base.ref,base.sha}`; `position` is 1-based from
the bottom.

⚠️ **`github.event.pull_request.base.ref` is the layer below, not the trunk.** Any `if:`
you wrote comparing it to `'main'` silently stops matching for every layer except the
bottom. Use `stack.base.ref` for "what does this ultimately target".

⚠️ **`stacked` is a webhook action, not an Actions activity type.** It fires when a PR
joins a stack, but it is **not** in the `pull_request` types list Actions accepts — a
GitHub App can subscribe, `types: [stacked]` in a workflow cannot. Related: the `opened`
event **never** carries a `stack` object (a PR is created *before* it joins a stack), so
any first-open logic sees `null`.

### 3. PR titles are auto-generated in CI — the normaliser matters more, not less

Two modes, and **agents only ever get the second**. Interactively, `gh stack submit`
opens an editor to write each PR's title, body and draft state. **Non-interactively it
skips the editor and auto-generates titles** from commit messages plus a footer — `--auto`
is implied in CI, and there is **no flag to set a title or body**, so the editor is the
only way to set one. Auto-generated PRs are created as **drafts** unless `--open`
(verified against `gh stack submit --help`, v0.1.0). Since each layer
squash-merges into `main` as its own commit, each layer's title drives its own
semantic-release bump. Keep layer commits conventional, and let
[`pr-title-manager.yml`](./templates/pr-title-manager.yml) fix the rest — or `gh pr edit`
after submit.

**One logical change per layer** is the same rule as one-change-per-PR, and it matters
more here: five layers produce five commits on `main`.

### 4. Merging a stack is a different command

**`gh pr merge` does not work on a stacked PR** — use `gh stack merge --yes`, which merges
bottom-to-top **atomically** (all-or-nothing). Pass `--squash` to keep the squash
convention; without a method flag it reuses the last-used one. It checks only that PRs are
open and non-draft — your required checks and branch protection still apply and still
block, and **bypassing merge requirements is not supported for stacks**.

With a **merge queue**, the stack is enqueued instead: the queue picks the method (any
`--squash` you pass is **ignored with a warning**) and layers may land in **separate
groups** rather than together.

### 5. Never delete a mid-stack branch

Deleting a branch that open PRs use as their **base closes those PRs**. That's the whole
stack above it. See [`branch-cleanup`](../branch-cleanup/SKILL.md), which refuses exactly
this.

## Gotchas

- **Three modes — and don't loop on your own edits.** The template classifies each
  PR: `skip` only for **`github-actions[bot]`** (its *own* title edits — the workflow
  listens for `edited` to re-validate human changes, and skipping its own identity
  stops the loop). With the **default `GITHUB_TOKEN` this is belt-and-braces** —
  GitHub deliberately doesn't retrigger workflows on events its own token caused, so
  the bot's edit wouldn't re-fire anyway; the skip only *matters* if you swap in a PAT
  or GitHub App token (whose edits **do** retrigger), so keep it. `validate` for
  **forks and other bots like dependabot**
  (read-only/untrusted → title is checked but never auto-edited); `normalize` for
  same-repo human PRs (run the script + fix the title). Don't blanket-skip all bots —
  a non-self bot with a non-conventional title would otherwise merge unchecked.
- **Agent/bot branch prefixes don't infer a type.** `claude/ cursor/ codex/ …`
  are valid branch names, but the normaliser derives the type from the PR's
  **commits** (which should be conventional), not the prefix — falling back to
  `chore` only if neither title nor commits are conventional. Keep agent commits
  conventional so the bump is right.
- **Fork / bot PRs are validate-only.** `pull_request` from a fork gets a
  **read-only** token *and* an attacker-controlled checkout, so the template never
  checks out or runs the (PR-modifiable) script for them — it validates the title
  inline via the API (read-only) and **fails** if it isn't a valid Conventional
  Commit (any type, including non-releasing `docs:`/`chore:`), or if a `type!:`-style
  breaking commit isn't reflected by a `!` in the title. Same-repo human branches
  (the norm for this trunk-based workflow) are the only ones auto-edited. Configure
  dependabot with a conventional `commit-message.prefix` so its titles pass.
- **Squash settings are per-repo and easy to miss** — if "Default commit message"
  is left as "Default" (the first commit's message) instead of **"Pull request
  title and commit details"**, your carefully-named PR title is ignored at merge.
- **The opt-out suppresses the rewrite, not the validation.** The
  `skip-title-automation` label stops the auto-edit + sticky comment but the title is
  **still checked** (the required check fails until it's a valid Conventional Commit) —
  full details in [Opting out](#opting-out-of-the-auto-rewrite) above. A green check
  always means a releasable title; the label can't bypass that.

## See also

- [`conventional-commits`](../conventional-commits/SKILL.md) — the format the title
  must follow.
- [`semantic-release-automation`](../semantic-release-automation/SKILL.md) — consumes
  the squashed commit to cut the release.
- [`production-release-gating`](../production-release-gating/SKILL.md) — deploys only
  the resulting release.
- [`resolve-merge-conflicts`](../resolve-merge-conflicts/SKILL.md) — resolving the
  conflicts/behind-base updates a branch hits before it can squash-merge.

## Sources

- Generalised from a production app's `branch-name-check.yml` (the
  `feature|fix|hotfix|codegen-bot|copilot|codex|cursor|claude|dependabot` prefix
  set) and `pr-title-manager.yml` + `normalize-pr-title.js` (title normalisation,
  the `skip-title-automation` label opt-out, bot-cascade guard, sticky comment).
- GitHub squash-merge commit-message options:
  <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/configuring-commit-squashing-for-pull-requests>
