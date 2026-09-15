#!/usr/bin/env bash
# Publish the built site to the gh-pages branch.
#
#   npm run deploy
#
# GitHub Pages serves this repo from the gh-pages branch root, so the
# deploy is: build, then replace that branch's contents with dist/.
# (An Actions workflow would be tidier, but pushing .github/workflows
# needs a token with the "workflow" scope — see README.)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKTREE="$(mktemp -d)/gh-pages"

cd "$ROOT"
npm run build

git worktree prune

# Base the worktree on the published branch so the deploy commit stacks on
# the history the remote already has. Branching from main instead would
# diverge and the push would be rejected on any clone that hasn't deployed
# before -- which is every fresh clone. Fall back to main on a first deploy,
# when there is no gh-pages upstream yet.
if git fetch -q origin gh-pages 2>/dev/null; then
  BASE=origin/gh-pages
else
  BASE=main
fi
git worktree add -B gh-pages "$WORKTREE" "$BASE" -q

cd "$WORKTREE"
git rm -rq --cached .
find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -R "$ROOT/dist/." .
touch .nojekyll                      # keep Jekyll's hands off _-prefixed paths

git add -A
if git diff --cached --quiet; then
  echo "✓ nothing changed"
else
  git commit -qm "Deploy site ($(date -u +%Y-%m-%dT%H:%MZ))"
  git push -q origin gh-pages
  echo "✓ deployed → https://omarnaous.github.io/FolieApresmidi/"
fi

cd "$ROOT"
git worktree remove --force "$WORKTREE"
