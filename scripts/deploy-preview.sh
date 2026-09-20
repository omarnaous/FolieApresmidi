#!/usr/bin/env bash
#
# Stands up the free-plan preview shop from nothing: secrets, deploy, seed.
# Safe to re-run — secrets are overwritten with the same values and the seed
# uses INSERT OR REPLACE, so a second run just refreshes the deployment.
#
#   ./scripts/deploy-preview.sh
#
# Needs Node >= 22 and a Cloudflare login (`npx wrangler login`, or
# CLOUDFLARE_API_TOKEN set). See docs/DEPLOY.md §0 for what preview gives up.

set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

# ---------------------------------------------------------------- 1. secrets
# The seed hashes passwords with these, so .dev.vars and the deployed secrets
# have to agree. Whatever is already in .dev.vars wins; the rest is generated.
if [ ! -f .dev.vars ]; then
  say "No .dev.vars — creating one"
  cp .dev.vars.example .dev.vars
fi

read_var() { sed -n "s/^$1=//p" .dev.vars | head -1; }
set_var() {
  if grep -q "^$1=" .dev.vars; then
    # portable in-place edit: BSD sed needs an argument to -i, GNU sed does not
    sed "s|^$1=.*|$1=$2|" .dev.vars > .dev.vars.tmp && mv .dev.vars.tmp .dev.vars
  else
    printf '%s=%s\n' "$1" "$2" >> .dev.vars
  fi
}
rand() { node -e "console.log(require('crypto').randomBytes($1).toString('base64url'))"; }

for pair in "PASSWORD_PEPPER 48" "COOKIE_SECRET 48" "SETUP_TOKEN 24"; do
  set -- $pair
  [ -n "$(read_var "$1")" ] || { set_var "$1" "$(rand "$2")"; echo "generated $1"; }
done
# Preview runs on the free plan's 10 ms of CPU, which 100,000 PBKDF2 rounds
# overrun. Must match env.preview in wrangler.jsonc or seeded logins fail.
set_var PASSWORD_ITERATIONS 10000

say "Pushing secrets to env.preview"
for name in PASSWORD_PEPPER COOKIE_SECRET SETUP_TOKEN RESEND_API_KEY; do
  value="$(read_var "$name")"
  if [ -z "$value" ]; then
    echo "skipping $name (empty in .dev.vars)"   # RESEND_API_KEY is optional: mail is logged instead
    continue
  fi
  printf '%s' "$value" | npx wrangler secret put "$name" --env preview >/dev/null
  echo "set $name"
done

# ------------------------------------------------- 2. build, migrate, deploy
say "Typecheck, tests, build, migrate, deploy"
npm run deploy:preview

# --------------------------------------------------------------- 3. the shop
say "Seeding the catalogue"
npm run db:seed:preview

say "Done"
cat <<'EOF'
  https://fdm-preview.follies.workers.dev
  https://fdm-preview.follies.workers.dev/admin

  owner     owner@fdm.test     / fdm-owner-local-2026
  codes     WELCOME10  NEWSLETTER15  TWENTYOFF  FREESHIP  JEWELLERY3FOR2

  No image uploads (no R2), jobs run inline (no Queues), full-size images
  (no Images binding), and passwords hash at 1/10th strength. Preview only.
EOF
