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
git worktree add -B gh-pages "$WORKTREE" main -q

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
