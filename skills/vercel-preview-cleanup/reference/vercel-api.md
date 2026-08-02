# Vercel REST API — listing & deleting preview deployments

**Verified against live docs + the machine-readable OpenAPI spec (`openapi.vercel.sh`)
and Vercel's own CLI source on 2026-08-01.** Re-verify before trusting anything here
that would cause a deletion. Endpoint versions have drifted before (v6 → v7 for list).

## The five facts that break naïve implementations

1. **`target` is `null` for previews in *responses*.** The response enum is
   `"production" | "staging" | null`. A client-side guard of
   `select(.target == "preview")` matches **zero rows** and silently deletes nothing.
   Guard with `.target != "production"` instead. (`target=preview` *is* valid as a
   **request** filter — the asymmetry is the trap.)
2. **One list call is never enough.** There is no "return everything" mode. You must
   loop until `pagination.next` is `null`. A single `limit=100` returns the newest 100
   and silently orphans the rest — the exact bug this skill exists to prevent. Neither
   `count` nor a short array is an end-of-data signal.
3. **`pagination.next` is a millisecond timestamp, not an opaque cursor**, and you
   pass it back as **`until`**. (Confirmed in Vercel CLI's `Client.fetchPaginated`.)
4. **Deletes are rate-limited to 200 per 600 s per owner** — that is **1 delete per
   3 seconds** sustained, not 3/s. Getting this backwards produces 429s partway
   through a sweep and leaves half the deployments orphaned.
5. **Delete is a *soft* delete** (30-day recovery). Deleted deployments may still
   appear in later list calls with `readyState: "DELETED"` — filter them or you will
   re-attempt deletes on tombstones every run.

## List deployments

`GET https://api.vercel.com/v7/deployments` — current. (`/v6` still works and is what
Vercel's CLI calls; `/v13` is create + get-by-id only, **not** list.)

| Param | Notes |
| --- | --- |
| `projectId` | ID **or** name. Mutually exclusive with `projectIds`. |
| `projectIds` | 1–20 items — useful for monorepos mapping to several Vercel projects. |
| `teamId` / `slug` | **Required in practice** for team-owned projects; omit it and the request resolves against your personal account and 403/404s. |
| `target` | `preview` is valid as a request filter (documented at the CLI layer; **no enum in the REST reference** — documented by inference). |
| `branch` | Documented in the REST reference + OpenAPI + `@vercel/sdk`. **But Vercel's own CLI filters via `meta-githubCommitRef` instead** — if `branch` returns unexpectedly empty, fall back to `meta-githubCommitRef=<branch>`. |
| `limit` | **No documented max**; the CLI hard-validates 1–100 and defaults to 100. Treat 100 as the ceiling. |
| `since` / `until` | ms timestamps. `until` is the pagination cursor. |
| `from` / `to` | **Deprecated** in the OpenAPI — use `since`/`until`. |
| `state` | `BUILDING, ERROR, INITIALIZING, QUEUED, READY, CANCELED, BLOCKED`. |

Response: `{ deployments: [...], pagination: { count, next, prev } }`. **Terminate when
`pagination.next === null`** — that is the only end-of-list signal.

Undocumented but real: `meta-<key>` filters (e.g. `meta-githubCommitRef`), built by the
CLI and surfaced via `vercel ls -m`.

### Custom environments

Deployments to **custom environments** carry `customEnvironment: {id, slug}`. Whether
they appear under `target=preview` is **unverified**. For "everything non-production for
this branch", omit `target` from the request and exclude `.target == "production"`
client-side — that is what the bundled workflow does.

## Delete a deployment

`DELETE https://api.vercel.com/v13/deployments/{id}?teamId=<team>` — current.

- `id` path param is required. Optional `url` query param **overrides** the id.
- `200 {"uid":"dpl_…","state":"DELETED"}` · `400` · `401` · `403` · `404` ·
  `410` (declared in the spec with no description).
- **Treat `200`, `404` and `410` as terminal success**; retry only `429`/`5xx`.
  Idempotency is *not* documented — both `404` and `410` are declared, and which one a
  soft-deleted deployment returns is unverified.

## Rate limits (from `/docs/limits`)

| Operation | Limit | Window | Scope |
| --- | --- | --- | --- |
| **Deployment deletion** | **200** | **600 s** | owner (team) |
| Deployment list | 1000 | 60 s | user |
| Deployment retrieval | 500 (2000 Enterprise) | 60 s | user |

Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`. No `429` is
declared on these endpoints in the OpenAPI and no `Retry-After` is documented for them —
so **pace proactively** (≥3 s between deletes) and back off on `X-RateLimit-Reset` if you
see a 429. A branch with 400 previews **cannot** be cleaned in one 10-minute window;
that is a fact of the API, not a bug in the workflow — the sweep picks up the remainder.

## Retention — an independent backstop, not a substitute

Retention is configured per project (`deploymentExpiration`: `expirationDays`,
`expirationDaysProduction`, `expirationDaysCanceled`, `expirationDaysErrored`,
`deploymentsToKeep`). **`deploymentsToKeep` is production-only** — there is no
`previewDeploymentsToKeep`.

Vercel's *automatic* retention job refuses to delete a deployment while any of these
hold (verbatim from `/docs/deployment-retention`):

- one of the **last 10 deployments created in the project**
- one of the **last 20 production deployments in state Ready**
- one of the **last 20 non-production deployments in state Ready**
- has a production alias assigned
- is the target of a branch alias for a custom environment
- is non-production and has any custom alias assigned
- **is the latest preview deployment for a Git branch that is still active** (branch not
  deleted, PR not merged/closed)

> ⚠️ **These exceptions constrain Vercel's retention job — NOT your explicit
> `DELETE`.** Whether the API refuses an explicit delete of a protected deployment is
> **unverified**; assume it does not. This is why the workflow only ever runs against a
> branch that has already been **deleted** — the "latest preview for an active branch"
> case cannot arise. Do not repurpose the delete loop against live branches without
> reimplementing that floor yourself.

Vercel's own warning, worth surfacing to users: *"Deleting a deployment prevents you from
using instant rollback on it and might break the links used in integrations, such as the
ones in the pull requests of your Git provider."*

## Auth

`Authorization: Bearer <token>`. Tokens are account-scoped, optionally project-scoped
(`vcp_…`). The specific RBAC role required to delete a deployment is **unverified** —
test with the actual CI token before relying on it. Team scoping via `teamId`/`slug` is
required in practice.

## Worked example — paginate to exhaustion

```bash
BASE="https://api.vercel.com/v7/deployments?projectId=${PROJECT_ID}&teamId=${TEAM_ID}&limit=100"
UNTIL=""
while :; do
  URL="$BASE"; [ -n "$UNTIL" ] && URL="${URL}&until=${UNTIL}"
  RESP=$(curl -sS --fail-with-body -H "Authorization: Bearer ${VERCEL_TOKEN}" "$URL")
  jq -r '.deployments[] | select(.target != "production") | .uid' <<<"$RESP"
  UNTIL=$(jq -r '.pagination.next // empty' <<<"$RESP")
  [ -z "$UNTIL" ] && break     # next === null is the ONLY end condition
  sleep 0.1                    # matches Vercel CLI's own inter-page sleep
done
```

## Provenance

Verified 2026-08-01 against `vercel.com/docs/rest-api/deployments/{list-deployments,
delete-a-deployment}`, `vercel.com/docs/limits`, `vercel.com/docs/deployment-retention`,
the OpenAPI spec at `openapi.vercel.sh`, `@vercel/sdk@1.28.15`, and `vercel@58.4.4` CLI
source. Items marked **unverified** above were not resolvable from first-party docs —
treat them as open questions, not assumptions.
