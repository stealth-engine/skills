---
name: meaningful-linear-issues
description: "Create complete, analytics-ready Linear issues in ONE pass — resolve the right project (never guess it), and proactively fill the metadata that's technically optional but matters for planning/analytics: priority, estimate, labels (a Type + an Area from the team's existing taxonomy), milestone, assignee, cycle, and relations. Use when asked to 'create/file/open a Linear issue', 'log a ticket', 'add this to Linear', 'make an issue for X', or when creating an issue via Linear's save_issue (no `id`) — so the user doesn't have to come back and ask for the labels/estimate/project a second time. Also use to backfill missing metadata on a bare issue, or when an issue might land in the wrong project. NOT for routine updates to an existing issue (status changes, reassignments, edits) — those are also save_issue but don't need this."
metadata:
  author: stealth-engine
  version: "1.0.0"
---

# Meaningful Linear issues

A good issue is **not** just a good description — that's the easy half. The half
agents skip is the **metadata** that makes Linear actually work as a planning tool:
estimates feed cycle velocity, labels feed breakdowns, milestones feed roadmaps, the
project feeds everything. Those fields are *optional in the API*, so agents leave them
blank and the user has to come back and ask again.

**Flip the default: metadata is opt-OUT, not opt-in.** Resolve and fill it **before**
calling `save_issue`, in one pass — propose concrete values, don't omit.

## Cardinal rule: never guess the project

The single worst failure is dropping an issue into the **wrong/random project**.
Resolve the project in this order — **stop at the first that's certain**:

1. **Context** — the issue's repo/area maps to a known project; the user named it; a
   sibling issue you're relating to has one.
2. **Confirm** — call [`list_projects`](#discover-valid-values) and match by name; if
   one clearly fits, state which and proceed.
3. **Ask** — if it's still ambiguous, **ask the user which project** rather than
   picking one. A missing project is recoverable; a wrong one quietly pollutes the
   wrong roadmap.

Never pass a `project` you inferred from vibes. Team is required too — usually
unambiguous from the project, but resolve it the same way.

## The one-pass workflow

1. **Discover** what's available (only what you don't already know): projects, the
   team's label taxonomy, milestones, the current cycle, assignable users.
2. **Draft** the issue with **every applicable field filled** (checklist below).
3. **Create** with one `save_issue` call. If anything was genuinely a judgment call
   (estimate, priority), **state the values you chose** so the user can correct one —
   that's still one pass, not "I left them blank, ask me again."

## Metadata checklist — fill before `save_issue`

| Field | How to set it well |
| --- | --- |
| **team** *(required)* | From the project. `list_teams` / `get_team` if unknown. |
| **project** | **Resolve, never guess** (above). |
| **title** | Imperative, specific, scannable. Lead with the verb + the object. |
| **description** | The implementation detail (see [template](#description-template)). |
| **priority** | `1` Urgent · `2` High · `3` Medium · `4` Low · `0` None. Infer from impact/urgency; default `3` for normal work, ask if it's clearly load-bearing. |
| **estimate** | Set a real value. **It snaps to the team's scale** — e.g. passing `3` on a Fibonacci/exponential team may come back as `4 Points`; that's expected, not an error. Some teams **disable** estimates — if `save_issue` rejects it, drop the field. |
| **labels** | Pick from the **existing taxonomy** (`list_issue_labels` for the team) — **don't invent labels**. Typically one **`Type`** (Feature / Bug / Improvement / Chore / Docs / Refactor / Security / Performance / Test / …) **and** one **`Area`** (the relevant module/domain). Match the repo's grouped labels rather than guessing names. |
| **assignee** | `"me"`, the named owner, or the project/issue's usual owner (`list_users` to resolve a name/email). Don't leave unassigned if an owner is obvious. |
| **milestone** | `list_milestones` for the project; attach if one fits the work. (None exist? skip — don't fabricate.) |
| **cycle** | Often **auto-assigned** to the active cycle on create. Only set it explicitly (`list_cycles` → `current`) if you need a specific one. |
| **relations** | `parentId` for sub-work; `blocks` / `blockedBy` for ordering; `relatedTo` for siblings. Link issues you reference in the description — it's cheap and powers dependency views. |

If a field genuinely doesn't apply (e.g. no milestones exist), skip it **knowingly** —
the goal is "nothing useful left blank," not "every field stuffed."

## Discover valid values

Only the values you don't already have in context. These are the Linear MCP tools:

- `list_projects` (filter by name/team) — resolve the project.
- `list_issue_labels` (by `team`) — the label taxonomy; reuse, don't invent.
- `list_milestones` (by `project`) — fitting milestone, if any.
- `list_cycles` (by `teamId`, `type: current`) — only if not auto-assigned.
- `list_users` (by name/email, or `"me"`) — resolve an assignee.
- `list_teams` / `get_team` — when the team isn't obvious from the project.

Then create with `save_issue` (omit `id` to create). `labels` and `assignee` accept
**names or IDs**; `priority` is the `0–4` int.

## Description template

Keep what makes implementation unambiguous; drop ceremony:

```markdown
<one-line summary of the outcome>

## Context / problem
<why this exists; the symptom or goal; link related issues/PRs>

## Scope
<what's in; explicitly what's out>

## Acceptance
<how we'll know it's done — checkable bullets>
```

Use **real newlines and markdown**, not escaped `\n`. Mention related issues by ID so
Linear links them (and add them to `relatedTo`).

## Gotchas

- **Don't guess the project** — the one unrecoverable mistake. Ask if unsure.
- **Estimate snaps to the team's scale** (a passed `3` may store as `4 Points`); and
  some teams disable estimates entirely — drop the field if it's rejected.
- **Labels must already exist** — pull them from `list_issue_labels` and pass the
  exact names; creating ad-hoc labels pollutes the taxonomy. Prefer one Type + one Area.
- **Milestone belongs to a project, cycle belongs to a team** — don't cross them; a
  milestone from another project will be rejected.
- **Cycle is usually auto-set** on create — don't fight it unless you need a specific one.
- **One pass, not two** — if you're unsure of priority/estimate, pick a sensible value
  and *say so*; don't ship a bare issue and wait to be asked for the rest.

## Pre-flight checklist (before `save_issue`)

- [ ] **Project resolved** (from context/confirmed/asked) — **not** guessed.
- [ ] Team set; title imperative + specific; description has context + scope + acceptance.
- [ ] Priority set; estimate set (or knowingly skipped if the team disables it).
- [ ] Labels: a **Type** (always) + an **Area** *if one fits* — from the existing taxonomy, not invented.
- [ ] Assignee set (or deliberately left for triage); milestone attached if one fits.
- [ ] Relations linked for any issues/PRs referenced.
- [ ] Anything you judged (priority/estimate) stated back to the user in your reply.

## See also

- [`conventional-commits`](../conventional-commits/SKILL.md) — the matching discipline
  for commit/PR titles, so the issue → branch → PR → release chain stays clean.

## Sources

- Linear MCP tool surface (`save_issue`, `list_projects`, `list_issue_labels`,
  `list_milestones`, `list_cycles`, `list_users`, `get_team`) and observed behaviour:
  estimates snap to the team's scale, new issues auto-join the active cycle, labels are
  a grouped Type/Area taxonomy that must pre-exist.
