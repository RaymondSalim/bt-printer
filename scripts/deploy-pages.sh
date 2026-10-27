#!/usr/bin/env bash
# Publishes the built app, and nothing else, to a separate public repository's gh-pages
# branch, which GitHub Pages serves. The source repository stays private, so its history
# (which holds real tracking numbers used as test fixtures) is never published.
#
# One-time setup:
#   gh repo create RaymondSalim/bt-printer-app --public --description "Static build of bt-printer"
#   scripts/deploy-pages.sh
#   gh api -X POST repos/RaymondSalim/bt-printer-app/pages -f 'source[branch]=gh-pages' -f 'source[path]=/'
#
# Usage:
#   scripts/deploy-pages.sh            build and publish
#   DRY_RUN=1 scripts/deploy-pages.sh  build and list what would be published
#
# The published branch is a single fresh commit each time, force-pushed, so the public
# repository never accumulates history. Commits use the GitHub noreply address unless
# DEPLOY_GIT_NAME and DEPLOY_GIT_EMAIL are set.
set -euo pipefail

DEPLOY_REPO="${DEPLOY_REPO:-git@github.com:RaymondSalim/bt-printer-app.git}"
BRANCH="gh-pages"

cd "$(git rev-parse --show-toplevel)"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Commit or stash your changes first, so the published build matches a commit." >&2
  exit 1
fi
SOURCE_SHA="$(git rev-parse --short HEAD)"

npm run build

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R dist/. "$STAGE/"
touch "$STAGE/.nojekyll"

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "Would publish to $DEPLOY_REPO ($BRANCH):"
  (cd "$STAGE" && find . -type f | sort)
  exit 0
fi

NAME="${DEPLOY_GIT_NAME:-$(gh api user --jq .login)}"
EMAIL="${DEPLOY_GIT_EMAIL:-$(gh api user --jq '"\(.id)+\(.login)@users.noreply.github.com"')}"

cd "$STAGE"
git init -q -b "$BRANCH"
git add -A
git -c user.name="$NAME" -c user.email="$EMAIL" commit -q -m "Deploy build of $SOURCE_SHA"
git push --force "$DEPLOY_REPO" "$BRANCH"
echo "Published build of $SOURCE_SHA to $BRANCH."
