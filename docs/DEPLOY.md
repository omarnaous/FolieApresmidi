# Deploying

One Worker serves the storefront, the admin, the API and the images. There are
four environments in `wrangler.jsonc`:

| Environment | Worker | Config | Used for |
|---|---|---|---|
| development | — | top level | `npm run dev:worker`; everything simulated on disk |
| preview | `fdm-preview` | `env.preview` | a throwaway shop on the **free plan** (see §0) |
| staging | `fdm-staging` | `env.staging` | a real copy to try changes on |
| production | `fdm` | `env.production` | the shop |

Bindings are never inherited by a named environment, so each one lists its own
D1, KV, R2, Queues and rate limiters. Run every command with Node ≥ 22
(`nvm use 22`).

---

## 0. The free-plan preview

`env.preview` exists to click through the shop before the account has R2 or a
paid plan. It binds only what the free plan gives you — D1, KV, rate limiting,
cron — and the Worker notices the rest is missing and degrades:

| Missing | What happens instead | What you lose |
|---|---|---|
| R2 (`MEDIA`) | `/media/<key>` streams from the image's `source_url` | admin image upload and CSV import answer "File storage (R2) is not enabled" |
| Queues (`JOBS`) | `enqueue()` runs the job inline on the request | emails and collection rebuilds add latency to the request that triggered them |
| Images (`IMAGES`) | `?w=` returns the original | no WebP resizing, so pages pull full-size images |

It also hashes passwords at 10,000 PBKDF2 rounds instead of 100,000, because
the free plan gives a request 10 ms of CPU and the full count does not fit.
**This is a preview-only weakening** — staging and production hash at full
strength. Do not point a real shop at this environment.

```bash
npx wrangler secret put PASSWORD_PEPPER --env preview   # and COOKIE_SECRET, SETUP_TOKEN
npm run deploy:preview      # typecheck → tests → build → migrate → deploy
npm run db:seed:preview     # 54 demo products, discount codes, a test owner
```

The seeded accounts only work if `PASSWORD_PEPPER` and `PASSWORD_ITERATIONS`
match the `.dev.vars` the seed was built from — `db:seed:preview` rebuilds it,
so set `.dev.vars` first.

---

## 1. Before the first deploy

Things only you can do, in the Cloudflare dashboard or with your own accounts:

- [ ] **Workers Paid** ($5/month). The free plan's 10 ms CPU limit cannot do
      password hashing, CSV imports or order commits.
- [ ] **Enable R2** (Dashboard → R2). It needs a payment method even for the
      free tier. Product images live there.
- [ ] **Resend** account, and a verified sending domain (SPF, DKIM, DMARC).
      Mail cannot be sent from a `@gmail.com` address. Until a key is set, every
      email is logged instead of sent, and the store keeps working.
- [ ] **A domain**, if the shop is to have its own (see §6).

## 2. Create the resources

Once per environment (`--env staging` shown; repeat with `--env production`,
where the D1 database already exists):

```bash
npx wrangler d1 create fdm-staging
npx wrangler kv namespace create KV --env staging
npx wrangler r2 bucket create fdm-media-staging
npx wrangler queues create fdm-jobs-staging
npx wrangler queues create fdm-jobs-dlq-staging
```

Each command prints an id. Put the D1 `database_id` and the KV `id` into the
matching environment block in `wrangler.jsonc`, then regenerate the types:

```bash
npm run types
```

## 3. Secrets

Four per environment. Generate long random values (`openssl rand -hex 32`) and
keep them somewhere safe — changing `PASSWORD_PEPPER` after launch invalidates
every password.

```bash
npx wrangler secret put PASSWORD_PEPPER --env staging
npx wrangler secret put COOKIE_SECRET   --env staging   # signs cart cookies and recovery links
npx wrangler secret put SETUP_TOKEN     --env staging   # unlocks /admin setup once
npx wrangler secret put RESEND_API_KEY  --env staging   # optional; emails are logged without it
```

Locally these live in `.dev.vars` (gitignored; copy `.dev.vars.example`).

## 4. Deploy

```bash
npm run deploy:staging     # typecheck → tests → build → migrate → deploy
npm run deploy:prod
```

Each script refuses to deploy if the types or tests fail, applies any new
migrations to that environment's database, then uploads. To do it by hand:

```bash
npm run build
npx wrangler d1 migrations apply DB --remote --env production
npx wrangler deploy --env production
```

Migrations run before the new code: every migration must work with the version
already deployed (add columns, don't rename them in the same release).

### Automatic deploys

`.github/workflows` needs a token with the `workflow` scope, which this repo's
CLI login does not have. Either:

- **Cloudflare Workers Builds** — connect the repository under Workers & Pages →
  the `fdm` Worker → Settings → Builds. Build command `npm run build`, deploy
  command `npm run deploy:prod` (and a `staging` branch running
  `npm run deploy:staging`), or
- **GitHub Actions** — run `gh auth refresh -s workflow` once, then add a
  workflow that runs the same npm scripts with `CLOUDFLARE_API_TOKEN`.

## 5. First run

The catalogue starts empty in a new environment.

```bash
node scripts/build-seed.mjs
npx wrangler d1 execute DB --remote --env production --file=seed/catalog.sql
```

`seed/dev.sql` is local-only — never apply it remotely; it contains known
passwords.

Then create the owner account: open `https://<worker-url>/admin`, and the setup
screen asks for the `SETUP_TOKEN` you set above along with a name, email and
password. It only works while no staff account exists. Afterwards, in the admin:

- [ ] **Shipping** — set the real delivery fee (seeded at 0).
- [ ] **Products** — set real stock quantities (seeded at 6 per selling piece).
- [ ] **Taxes** — turn on VAT only if the store charges it (seeded off).
- [ ] **Settings** — contact details, the category menu, and the notification
      address for new orders.

## 6. A custom domain

The store currently answers on `workers.dev`. To move it to its own domain:

1. Add the domain to Cloudflare (Dashboard → Add a site) and point its
   nameservers there.
2. Worker → Settings → Domains & Routes → **Add custom domain**.
3. Set `APP_URL` and `ALLOWED_ORIGINS` for that environment in `wrangler.jsonc`
   to the new origin, and deploy again. They are what link building, emails,
   canonical URLs and the CSRF origin check use.
4. Verify the Resend sending domain on the same domain.

**Coming from Shopify:** keep the Shopify store serving until the cutover, run
the import, check the catalogue in `/admin`, then move the DNS record. Orders
placed on Shopify stay in Shopify; this store starts its numbering at #1001.

## 7. After deploying

- **Check:** `/` loads, `/products/<handle>` shows a product with its meta tags
  (view source: `og:title`, JSON-LD), `/sitemap.xml` lists products,
  `/robots.txt` allows crawling in production only, `/admin` asks to sign in.
- **Logs and traces** are on (`observability` in the config): Workers dashboard
  → the Worker → Logs. Every request carries an `x-request-id`, and error
  responses include it, so a shopper's screenshot points at one request.
- **Cache** is purged automatically whenever a product, collection, page or
  setting changes; nothing needs to be cleared by hand after an edit.
- **Backups** are D1 Time Travel — any point in the last 30 days:
  ```bash
  npx wrangler d1 time-travel info fdm-store --env production
  npx wrangler d1 time-travel restore fdm-store --timestamp <unix-ms> --env production
  ```
  `wrangler d1 export` cannot dump the FTS5 search table; it is rebuilt from the
  products, so exclude it and reindex by re-saving products if you ever restore
  from a dump.
- **Rolling back** code (`npx wrangler rollback --env production`) does not roll
  back the database. If a release included a migration, undo the data change
  first (Time Travel), then roll back the Worker.

## 8. When something is wrong

| Symptom | Where to look |
|---|---|
| 500s with an `x-request-id` | Workers Logs, filter by that id |
| Orders not confirmed by email | `RESEND_API_KEY` set? Sending domain verified? Queue → `fdm-jobs` consumer errors, and its dead-letter queue |
| Images 404 | R2 enabled, bucket name matches the environment, the `media` row's `source_url` still reachable |
| "Too many attempts" | rate limits are per Cloudflare location; check the `RL_*` namespaces in the config |
| Stock looks wrong | Admin → product → variant → History shows every change and what caused it |
| Checkout says a piece is gone | it is: another order committed it, or a hold is active for 15 minutes |
