#!/usr/bin/env bash
# One-off backfill: delete preview deployments already accumulated for branches that
# no longer exist. The workflow only affects branches deleted from now on.
#
# DRY RUN BY DEFAULT. Set APPLY=1 to actually delete.
#
#   VERCEL_TOKEN=... TEAM_ID=team_x PROJECT_IDS=prj_a,prj_b REPO=owner/name \
#     ./vercel-backfill.sh
#   ... APPLY=1 ./vercel-backfill.sh
#
# Guards (identical to the workflow, deliberately duplicated — this runs outside CI):
#   1. branch must contain '/'          (flat trunks are never touched)
#   2. branch must not match a protected pattern (release/*, hotfix/* contain slashes)
#   3. deployment target must not be "production"
#   4. branch must not still exist in the repo
set -euo pipefail

: "${VERCEL_TOKEN:?set VERCEL_TOKEN}"
: "${TEAM_ID:?set TEAM_ID}"
: "${PROJECT_IDS:?set PROJECT_IDS (comma-separated)}"
: "${REPO:?set REPO as owner/name}"
APPLY="${APPLY:-0}"
INTERVAL="${INTERVAL:-3}"   # Vercel: 200 deletes / 600s / team = 1 per 3s sustained
PROTECTED="${PROTECTED:-main,master,develop,dev,staging,production,release/*,hotfix/*}"

API=https://api.vercel.com
AUTH=(-H "Authorization: Bearer ${VERCEL_TOKEN}")
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

command -v jq >/dev/null || { echo "jq required" >&2; exit 1; }
command -v gh >/dev/null || { echo "gh required" >&2; exit 1; }

echo "Fetching live refs for ${REPO}…"
gh api "repos/${REPO}/branches" --paginate --jq '.[].name' > "$tmp/live.txt"
# Open PR head refs too — a FORK PR's branch never appears in repos/$REPO/branches, so
# without this its previews look orphaned and get deleted while the PR is still open.
# Exhaustive (paginated) — `gh pr list --limit N` truncates, and fork heads beyond
# the cap would then look orphaned and be deleted while their PR is still open.
gh api graphql --paginate -f owner="${REPO%/*}" -f name="${REPO#*/}" -f query='
  query($owner:String!,$name:String!,$endCursor:String){
    repository(owner:$owner,name:$name){
      pullRequests(states:OPEN,first:100,after:$endCursor){
        pageInfo{ hasNextPage endCursor }
        nodes{ headRefName } } } }' \
  --jq '.data.repository.pullRequests.nodes[].headRefName' >> "$tmp/live.txt"
sort -u -o "$tmp/live.txt" "$tmp/live.txt"
echo "  $(wc -l < "$tmp/live.txt") live refs (branches + open PR heads)"

protected() {
  local b="$1" p
  IFS=',' read -ra pats <<< "$PROTECTED"
  for p in "${pats[@]}"; do
    p="$(echo "$p" | tr -d '[:space:]')"; [ -z "$p" ] && continue
    # shellcheck disable=SC2254
    case "$b" in $p) return 0 ;; esac
  done
  return 1
}

found=0; deleted=0; failed=0; kept=0
IFS=',' read -ra PROJECTS <<< "$PROJECT_IDS"
for PROJECT_ID in "${PROJECTS[@]}"; do
  PROJECT_ID="$(echo "$PROJECT_ID" | tr -d '[:space:]')"; [ -z "$PROJECT_ID" ] && continue
  echo "=== project ${PROJECT_ID}"

  # List every deployment, paginating to exhaustion. `target` is not sent as a request
  # filter: custom-environment deployments may not appear under target=preview.
  UNTIL=""; : > "$tmp/cand.txt"
  while :; do
    URL="${API}/v7/deployments?projectId=${PROJECT_ID}&teamId=${TEAM_ID}&limit=100"
    [ -n "$UNTIL" ] && URL="${URL}&until=${UNTIL}"
    RESP="$(curl -sS --fail-with-body "${AUTH[@]}" "$URL")"
    # target is null for previews — NEVER compare against "preview".
    jq -r '.deployments[]
           | select(.target != "production")
           | select((.readyState // .state) != "DELETED")
           | [.uid, (.meta.githubCommitRef // .meta.gitBranch // ""), (.url // "")]
           | @tsv' <<<"$RESP" >> "$tmp/cand.txt"
    UNTIL="$(jq -r '.pagination.next // empty' <<<"$RESP")"
    [ -z "$UNTIL" ] && break            # next === null is the ONLY end condition
    sleep 0.1
  done

  while IFS=$'\t' read -r uid ref url; do
    [ -z "$uid" ] && continue
    if [ -z "$ref" ]; then kept=$((kept+1)); continue; fi
    case "$ref" in */*) ;; *) kept=$((kept+1)); continue ;; esac       # guard 1
    if protected "$ref"; then kept=$((kept+1)); continue; fi           # guard 2
    if grep -qxF "$ref" "$tmp/live.txt"; then kept=$((kept+1)); continue; fi  # guard 4

    found=$((found+1))
    if [ "$APPLY" != 1 ]; then
      echo "  DRY-RUN would delete ${uid}  ${ref}  ${url}"
      continue
    fi
    # live.txt is a one-time snapshot and this loop sleeps ${INTERVAL}s per delete, so
    # it ages for many minutes. Re-verify the ref immediately before destroying it —
    # both as a branch and as an open PR head (a fork PR's head is never a branch
    # here). Fail closed on any lookup error.
    enc_ref="$(printf '%s' "$ref" | sed 's/%/%25/g; s/#/%23/g')"
    set +e
    probe="$(gh api "repos/${REPO}/branches/${enc_ref}" 2>&1)"; probe_rc=$?
    set -e
    if [ $probe_rc -eq 0 ]; then
      kept=$((kept+1)); found=$((found-1)); echo "  kept (branch recreated): ${ref}"; continue
    fi
    # Only a confirmed 404 proves absence. Auth/rate-limit/transient errors must NOT
    # be read as "branch is gone" — that would delete a live branch's previews.
    case "$probe" in
      *"Not Found"*|*"Branch not found"*) : ;;
      *) kept=$((kept+1)); found=$((found-1))
         echo "  kept (branch probe inconclusive): ${ref} — ${probe%%$'\n'*}" >&2; continue ;;
    esac
    if ! pr_live="$(gh pr list --repo "$REPO" --head "$ref" --state open \
                      --limit 1 --json number --jq 'length' 2>/dev/null)" || [ -z "$pr_live" ]; then
      kept=$((kept+1)); found=$((found-1)); echo "  kept (open-PR re-check failed): ${ref}" >&2; continue
    fi
    if [ "$pr_live" -gt 0 ]; then
      kept=$((kept+1)); found=$((found-1)); echo "  kept (now an open PR head): ${ref}"; continue
    fi
    CODE="$(curl -sS -o "$tmp/del.json" -w '%{http_code}' -X DELETE \
      "${AUTH[@]}" "${API}/v13/deployments/${uid}?teamId=${TEAM_ID}")"
    case "$CODE" in
      200|404|410) deleted=$((deleted+1)); echo "  deleted ${uid} (${ref})" ;;
      429) echo "  rate limited — sleeping 60s and retrying once" >&2; sleep 60
           CODE="$(curl -sS -o "$tmp/del.json" -w '%{http_code}' -X DELETE \
             "${AUTH[@]}" "${API}/v13/deployments/${uid}?teamId=${TEAM_ID}")"
           case "$CODE" in 200|404|410) deleted=$((deleted+1)) ;;
             *) failed=$((failed+1)); echo "  FAILED ${uid} (${CODE})" >&2 ;; esac ;;
      *) failed=$((failed+1)); echo "  FAILED ${uid} (${CODE})" >&2 ;;
    esac
    sleep "$INTERVAL"
  done < "$tmp/cand.txt"
done

echo
echo "candidates: ${found}   deleted: ${deleted}   kept: ${kept}   failed: ${failed}"
[ "$APPLY" = 1 ] || echo "DRY RUN — set APPLY=1 to delete."
[ "$found" -gt 200 ] && [ "$APPLY" = 1 ] && \
  echo "NOTE: >200 deletions exceeds Vercel's 200-per-600s ceiling; pacing at ${INTERVAL}s keeps you under it, so expect this to take a while."
[ "$failed" -eq 0 ]
