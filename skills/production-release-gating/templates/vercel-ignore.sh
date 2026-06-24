#!/bin/bash
# Vercel "Ignored Build Step". Wire it up via vercel.json:
#   { "ignoreCommand": "bash ../../scripts/vercel-ignore.sh" }   # monorepo app
# or Project Settings → Git → Ignored Build Step.
#
# Vercel convention (NOTE the inversion): exit 1 = BUILD, exit 0 = SKIP.
#
# Goal: deploy a PREVIEW on every feature-branch push, but on `main` deploy ONLY
# a release commit (from semantic-release) or an explicit marker — so a normal
# merge to main does NOT ship to production.
set -euo pipefail

BRANCH="${VERCEL_GIT_COMMIT_REF:-$(git branch --show-current)}"
MSG="$(git log -1 --pretty=%B)"
echo "Branch: $BRANCH"
echo "Commit: ${MSG%%$'\n'*}"

# Explicit skip on any branch.
if [[ "$MSG" == *"[skip-deploy]"* ]]; then echo "⏭️  skip marker"; exit 0; fi

# Feature branches → always build (preview deployments).
if [[ "$BRANCH" != "main" ]]; then echo "✅ preview branch → build"; exit 1; fi

# --- On main: strict. Only release commits or an explicit deploy marker. ---
if [[ "$MSG" == *"[deploy]"* ]]; then echo "🚀 deploy marker → build"; exit 1; fi

# semantic-release commit, e.g. "chore(release): 1.2.3" or "chore(my-app): release 1.2.3"
if [[ "$MSG" =~ ^chore(\(.+\))?:\ release ]] || [[ "$MSG" =~ ^chore\(.+\):\ ${BRANCH}?.*release ]]; then
  echo "📦 release commit → build"; exit 1
fi

# Monorepo: also build when a dependency package released, e.g.:
# if [[ "$MSG" =~ ^chore\((configs|i18n-routing)\):.*release ]]; then exit 1; fi

echo "❌ main, non-release commit → skip"
exit 0
