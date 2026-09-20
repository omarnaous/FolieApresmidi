# FOLLIES D'APRÈS MIDI

A luxury storefront and the shop behind it — React + Vite on the front, a
Cloudflare Worker on the back, one deploy. Épicée. Libre.

```bash
nvm use 22            # wrangler and react-router need Node ≥ 22
npm install
npm run db:reset      # migrate + seed the local database (54 real pieces)
npm run dev:worker    # API, images, SEO routes  → http://localhost:8787
npm run dev           # the site                 → http://localhost:5173
```

Open <http://localhost:5173>. Vite forwards `/api`, `/media/products`,
`/sitemap.xml`, `/robots.txt`, `/cart/recover` and `/unsubscribe` to the
Worker, so the browser sees one origin —
the same shape as production, where one Worker serves everything.

The seed prints the local admin sign-in (the owner, for `/admin`) and the
discount codes `WELCOME10`, `NEWSLETTER15`,
`TWENTYOFF`, `FREESHIP` and `JEWELLERY3FOR2`.

| Command | What it does |
|---|---|
| `npm run dev` / `npm run dev:worker` | the two development servers |
| `npm test` | unit + integration tests, inside workerd |
| `npm run typecheck` | strict TypeScript, worker and web |
| `npm run db:generate` | schema change → new SQL migration |
| `npm run db:migrate` / `db:seed` / `db:reset` | local database |
| `npm run types` | regenerate `worker-configuration.d.ts` after a binding change |
| `npm run deploy:staging` / `deploy:prod` | typecheck, test, build, migrate, deploy |

---

## What it is

A shop of Shopify's shape, on Cloudflare's runtime.

- **Storefront** — catalogue with full-text search, filters and facets; product
  pages with variants, live stock, a size chart and shop the look; a persistent bag; a
  three-step guest checkout. There are no customer accounts — nobody signs up;
  staff sign in to the admin.
- **Admin** (`/admin`) — dashboard, products and inventory, collections
  (manual and rule-based), orders with fulfilment and refunds, customers,
  discounts, shipping, taxes, pages, the website (the film, the ribbon, every
  section's words and order, the floors, the notebook, the pop-ups and the
  footer), the newsletter (the welcome code, and writing one letter to the
  list), staff with roles, and an audit log.
- **Payment** — cash on delivery, behind a provider interface that a gateway
  can be dropped into without touching business logic.
- **Jobs** — transactional email, abandoned-cart reminders, CSV imports and
  housekeeping, on queues and cron.

The architecture, the schema and the decisions behind them are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Deploying is
[docs/DEPLOY.md](docs/DEPLOY.md).

## Structure

```
worker/           the Worker — Hono
  app.ts            routes and middleware order
  routes/           store · cart · checkout · session (CSRF) · admin/* · webhooks · seo · media
  services/         catalog · cart · checkout · orders · inventory · collections · admin-products …
  domain/           pure rules: pricing · discounts · tax · shipping · order-state · math
  payments/         provider interface · registry · cod
  jobs/             queue consumer · cron · csv import
  db/               drizzle schema + client
  lib/              crypto · errors · cache · sanitize · csv · images · ids
shared/           the API contract: Zod inputs, DTO types, route map
src/              the site — existing components untouched in look, now fed by the API
  admin/            the admin app (lazy-loaded chunk, styles scoped under .adm)
  checkout/ content/   sheets that match the storefront's design system
  remotion/         the hero film
migrations/       numbered SQL, applied by wrangler
seed/             generated SQL (catalogue, and local-only demo data)
test/             unit + integration, run inside the Workers runtime
```

## The hero film

The hero is not a video file. It is a Remotion composition rendered live in the
browser by `@remotion/player`, so it stays sharp at any size, weighs nothing but
its images, and can be re-cut in code.

`src/remotion/HeroFilm.jsx` — the score, in five acts:

| Frames  | Act      | What happens                                                        |
|---------|----------|---------------------------------------------------------------------|
| 0–78    | Leader   | Academy countdown, timecode, registration marks                      |
| 70–260  | Épicée   | One frame as a plate, dated, beside the masked title                 |
| 250–440 | Libre    | Contact sheet — the feed tiles in, staggered, each frame dated       |
| 430–575 | Échappée | Drops to paper — three frames printed, with an ink band              |
| 565–760 | Wordmark | Logotype letter by letter over the night frame, fade to black        |

**Every picture is from @folliesdapresmidi** — `FEED` in `src/data/assets.js`,
files in `public/media/ig/`. Which frame plays which part is set by
`HERO_FRAME`, `SHEET`, `PAPER` and `FINALE` in that file; swap those and the
film re-cuts itself.

**Why they are framed, not full-bleed.** Instagram serves a logged-out grid at
640px. Run full-screen that's a 2× upscale and it shows; framed at 30–45% of the
frame each plate lands near 1:1, and the contact sheet is sharper still. It also
reads better — a lookbook spread rather than a slideshow. Only the finale goes
full-bleed, under 58% ink so the softness reads as grain.

It ends on black so the loop seam is invisible. 30 fps, 760 frames ≈ 25s.
Timings live in the `ACTS` object at the top of the file; the building blocks —
`Plate`, `Rise`, `RiseChars`, `Wipe`, `Grain`, `Label` — are in
`src/remotion/atoms.jsx`. `Hero.jsx` cuts the composition to the viewport's own
aspect ratio, so the film reflows for 21:9 desktop or 9:16 phone instead of
being letterboxed.

**Rendering it to MP4** (for Instagram, or as a `<video>` fallback):

```bash
npm i -D @remotion/cli
npx remotion render src/remotion/HeroFilm.jsx HeroFilm out/reel.mp4
```

## The catalogue

The catalogue lives in D1 and is edited in `/admin`. The seed fills it with the
real 54 pieces — names, prices, sizes, colours, descriptions and photography
pulled from the live Shopify store (`scripts/seed-data/shopify-products.js`,
turned into SQL by `scripts/build-seed.mjs`).

Two things the seed cannot know, both flagged in the admin:

- **Stock** — the store publishes availability, not counts. Seeded pieces get 6
  units where the store sells them and 0 where it does not. Set the real
  quantities in Admin → Products.
- **Delivery** — a Lebanon zone with a placeholder rate of 0. Set the real fee
  in Admin → Shipping. A VAT rate of 11% is prepared but inactive under Taxes;
  turn it on only if the store charges it.

Nothing else is invented. The exchange policy page is the store's published
terms, and product copy is the store's own.

### Imagery

Product photographs stay on the store's CDN until they are first requested:
each `media` row keeps its `source_url`, and `/media/products/…` copies the file
into R2 on first view, then serves it from there for good. Uploads through the
admin go straight to R2. Either way the Worker resizes on request
(`/media/<key>?w=640`, widths 320–2000) to WebP and caches the result at the
edge.

The Instagram frames in `public/media/ig/` are static files, not R2 — they are
brand content, and the film reads them directly.

## How the money works

- **Every amount is an integer in minor units.** No floats anywhere: `$145` is
  `14500`. `shared/money.ts` parses and formats at the edges.
- **Totals are computed on the server, only in `worker/domain/pricing.ts`.**
  The browser sends variant ids and quantities; prices, discounts, shipping and
  tax come from the database. A tampered request cannot set a price.
- **Stock is committed in one atomic batch.** `variants_stock` is a CHECK
  constraint, so a decrement that would go negative aborts the whole D1
  transaction — two shoppers racing for the last piece can never both win.
  Discount usage limits are guarded the same way.
- **Checkout holds stock for 15 minutes** (configurable) so a shopper filling in
  an address does not lose the piece to someone still browsing. Holds never
  change `on_hand`; only a placed order does.
- **Cash on delivery commits stock when the order is placed** — there is no
  webhook to wait for — and stays `unpaid` until staff record the cash. A
  gateway added later commits stock when its verified webhook confirms payment.

## Notes for whoever works on this next

- **Reveal masks clip an inner `.rv-curtain`, never the observed element.**
  An element clipped to zero height reports `intersectionRatio: 0`, so a
  self-clipping reveal can never fire itself. Same reason the reveal masks carry
  padding plus equal negative margin — a tight clip eats accents (É) and descenders.
- **One place decides whether the page may scroll** — the `locked` flag in
  `App.jsx`, which drives both `body.is-locked` and Lenis `stop()`/`start()`.
  It now follows the route: any sheet or drawer open means locked.
- **Motion is off** under `prefers-reduced-motion`: Lenis never starts and every
  reveal renders in its final state.
- **Packshot blending needs a backdrop of its own.** `mix-blend-mode` is trapped
  by the nearest stacking context, and a reveal's `clip-path` creates one — so
  the paper colour sits on the `.packshot` tile, not on the page behind it.
- **The filter chips scroll sideways on a phone** rather than wrapping into
  ragged rows. They deliberately carry no `scroll-snap`: `snap-align: start`
  ignores the container's padding and would shove the first chip flush against
  the screen edge, out of line with the heading above it.
- **Admin styles are scoped under `.adm`** and the admin never imports
  storefront components; the storefront never imports admin ones. That is what
  keeps the admin out of the shopper's bundle.
- **`shared/api.ts` is the contract.** Change it first, then the Worker, then
  the screens — the route map at the bottom of that file is the index.
