#!/usr/bin/env bash
# Bulk-enable `delete_branch_on_merge` across an org.
#
# There is NO org-level default for this setting (verified against PATCH /orgs/{org},
# which has no branch/merge properties), so it must be set per repo.
#
# DRY RUN BY DEFAULT. Set APPLY=1 to actually PATCH.
#
#   ORG=stealth-engine ./enable-auto-delete-org.sh
#   ORG=stealth-engine APPLY=1 ./enable-auto-delete-org.sh
#
# Skips: archived repos, forks (unless INCLUDE_FORKS=1), repos already enabled, and
# repos where you lack admin (reported, not failed — a 403 there is expected, not a bug).
set -euo pipefail

: "${ORG:?set ORG}"
APPLY="${APPLY:-0}"
INCLUDE_FORKS="${INCLUDE_FORKS:-0}"

command -v gh >/dev/null || { echo "gh required" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq required" >&2; exit 1; }

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

echo "Listing repos in ${ORG}…"
# --paginate is required: per_page maxes at 100 and this org is >100 repos.
gh api "orgs/${ORG}/repos?per_page=100&type=all" --paginate \
  --jq '.[] | [.full_name, (.archived|tostring), (.fork|tostring),
               (.delete_branch_on_merge|tostring), .permissions.admin] | @tsv' \
  > "$tmp/repos.tsv"
echo "  $(wc -l < "$tmp/repos.tsv") repos"

enabled=0; already=0; skipped=0; noadmin=0; failed=0

while IFS=$'\t' read -r full archived fork current admin; do
  [ -z "$full" ] && continue
  if [ "$archived" = true ]; then skipped=$((skipped+1)); continue; fi
  if [ "$fork" = true ] && [ "$INCLUDE_FORKS" != 1 ]; then skipped=$((skipped+1)); continue; fi
  if [ "$current" = true ]; then already=$((already+1)); continue; fi
  # `permissions.admin` comes back on the list payload for the authenticated user.
  if [ "$admin" != true ]; then
    noadmin=$((noadmin+1)); echo "  no admin, skipping: ${full}"; continue
  fi

  if [ "$APPLY" != 1 ]; then
    echo "  DRY-RUN would enable: ${full}"; enabled=$((enabled+1)); continue
  fi

  # -F (not -f) so `true` is sent as a JSON boolean, not the string "true".
  if gh api -X PATCH "repos/${full}" -F delete_branch_on_merge=true >/dev/null 2>"$tmp/err"; then
    enabled=$((enabled+1)); echo "  enabled: ${full}"
  else
    failed=$((failed+1)); echo "  FAILED: ${full} — $(tr -d '\n' < "$tmp/err")" >&2
  fi
  sleep 0.2     # stay clear of secondary rate limits across hundreds of repos
done < "$tmp/repos.tsv"

echo
echo "enabled: ${enabled}   already on: ${already}   skipped (archived/fork): ${skipped}"
echo "no admin: ${noadmin}   failed: ${failed}"
[ "$APPLY" = 1 ] || echo "DRY RUN — set APPLY=1 to apply."
echo
echo "NOTE: newly CREATED repos still need this. It can be set at creation via"
echo "POST /orgs/{org}/repos (requires org owner to set true), but NOT via the"
echo "template-generate endpoint — those need a follow-up PATCH."
[ "$failed" -eq 0 ]
