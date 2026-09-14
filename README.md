# FOLLIES D'APRÈS MIDI

A minimal luxury storefront for FDM — React + Vite, with a **Remotion** title
film as the hero. Épicée. Libre.

The catalogue is the real one: **54 products** pulled from the live Shopify
store, with its own prices, sizes, colours, descriptions and photography.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # → dist/
npm run catalogue  # re-pull the 54 products from the live store
```

The home page shows **10 pieces**; the full 54 live behind *Search* in the nav
or *See all pieces* under the grid — a full-screen catalogue with search, the
store's categories, and sorting.

---

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
full-bleed, under 58% ink so the softness reads as grain. If you have the
originals, drop them into `public/media/ig/` under the same names and the plates
can be widened in `Epicee` / `Libre`.

It ends on black so the loop seam is invisible. 30 fps, 760 frames ≈ 25s.

**Re-cutting it.** Timings live in the `ACTS` object at the top of the file;
`Wipe` markers sit at the bottom of `<HeroFilm>`. The building blocks —
`Plate`, `Rise`, `RiseChars`, `Wipe`, `Grain`, `Label` — are in
`src/remotion/atoms.jsx`.

**Format.** `Hero.jsx` cuts the composition to the viewport's own aspect ratio
and every measurement inside the film is relative to `useVideoConfig()`, so the
film reflows for 21:9 desktop or 9:16 phone instead of being letterboxed or
cropped. Type stays a constant percentage of viewport width.

**Rendering it to MP4** (for Instagram, or as a `<video>` fallback):

```bash
npm i -D @remotion/cli
npx remotion render src/remotion/HeroFilm.jsx HeroFilm out/reel.mp4
```

---

## The catalogue

`src/data/products.js` is **generated — don't hand-edit it.** Run
`npm run catalogue` to refresh from `folliesdapresmidi.com/products.json`
(`scripts/pull-catalogue.mjs`). It reads the product feed plus each collection
feed, and writes out:

```js
{ id, name, line, price, images[], sizes[], colours[], variants[], note, drop, available, url }
```

- **`line`** comes from the store's own collections (Bottoms, Tops, Dresses,
  Co-ords, Bralettes, Jackets, Overalls, Necklaces, Earrings, Bracelets).
- **`variants`** keep `{ id, size, colour, price, available }` — `id` is the real
  Shopify variant id, which is all a checkout permalink needs. The quick view can
  grey out a combination the store doesn't stock. Pieces sold as a single
  "Default Title" variant are listed as **One size** — which is how they're sold.
- **`drop`** marks the 14 pieces in *Échappée 4 à 7*; they sort to the front and
  carry the badge.
- **`note`** is the store's own description. Five pieces have none, and the panel
  simply omits the paragraph rather than inventing one.

Nothing in the UI states a fact the store doesn't. The exchange terms in the
quick view are their published policy (24 hours, exchange only, no refunds); the
house copy is from their About page. There are no invented care instructions,
fabric claims or shipping promises — if you add any, they need to be true.

### Imagery
Product photography is served from the store's own Shopify CDN, which resizes on
request (`?width=1400`). Nothing is copied into the repo, so new shots appear as
soon as the store updates. To go fully self-hosted, download each `images[]` URL
into `public/media/` and rewrite the paths in the generator.

The shots are ghost-mannequin on pure white, so `.packshot` in `styles.css`
multiplies them over a paper-coloured tile — the garment floats on the page
instead of sitting in a bright rectangle. Swap that one rule if the shooting
style ever changes.

### The feed frames
`public/media/ig/` holds ten frames from @folliesdapresmidi — 392 KB all in —
with their real post dates, shortcodes and a short descriptive label recorded in
`FEED`. These are files, not hotlinks: Instagram signs its CDN URLs and they
expire within days. To refresh, pull new frames and update `FEED`; the film and
the house section both read whatever is in that array.

They do double duty: the film uses them as plates, `Feed.jsx` uses them as the
house section's index, and the mobile menu shows the first three. Every one links
back to the post it came from via `post(code)`.

## Structure

```
src/
  remotion/     HeroFilm.jsx — the film    ·  atoms.jsx — its primitives
  components/   one file per section, plus Cursor / Preloader / drawers
  store/        cart.jsx — context + reducer, persisted to localStorage
  data/         assets.js (all imagery)    ·  products.js (catalogue, pop-ups)
  hooks/        useInView.js
  styles.css    design system: pigments, type scale, plate, reveals
```

### The house section
`Feed.jsx` is an index, not an essay — hover or tap a line and the plate changes;
the plate links out to the post. It reads the first six of `FEED`, so it stays
current with whatever is in that array.

### Quick view
One strip of shots serves both layouts: the wide panel lays out only the
selected one (thumbnails switch it, clicking the plate cycles), while a phone
lays out all of them and you swipe — the next shot peeks in at 76% width so the
gesture is discoverable. The piece is the first thing on screen either way.

### Catalogue and search
`Shop.jsx` renders the first `HOME_LIMIT` (10) of the active category and hands
off to `Catalogue.jsx` — a full-screen panel with search, category chips and
sorting. Search matches every typed word against the piece's name, category,
colours, sizes **and** the store's own description, so "brown", "lace" or "rouge"
all find things. Opening a piece from the catalogue layers the quick view above
it; closing the quick view leaves the catalogue where it was.

### Notes for whoever works on this next

- **Reveal masks clip an inner `.rv-curtain`, never the observed element.**
  An element clipped to zero height reports `intersectionRatio: 0`, so a
  self-clipping reveal can never fire itself. Same reason the reveal masks carry
  padding plus equal negative margin — a tight clip eats accents (É) and descenders.
- **One place decides whether the page may scroll** — the `locked` flag in
  `App.jsx`, which drives both `body.is-locked` and Lenis `stop()`/`start()`.
- **Motion is off** under `prefers-reduced-motion`: Lenis never starts and every
  reveal renders in its final state.
- **Packshot blending needs a backdrop of its own.** `mix-blend-mode` is trapped
  by the nearest stacking context, and a reveal's `clip-path` creates one — so
  the paper colour sits on the `.packshot` tile, not on the page behind it.
- **The filter chips scroll sideways on a phone** rather than wrapping into
  ragged rows. They deliberately carry no `scroll-snap`: `snap-align: start`
  ignores the container's padding and would shove the first chip flush against
  the screen edge, out of line with the heading above it.

---

## Wiring it up for real

The storefront is complete but deliberately headless — three seams to connect:

| Seam | Where | What to do |
|---|---|---|
| Checkout | `CartDrawer.jsx`, the Checkout button | The store is already Shopify and each variant carries its real `id`, so checkout is a permalink: `folliesdapresmidi.com/cart/{variantId}:{qty},…`. Carry the chosen variant's id onto the cart line and redirect |
| Catalogue | `data/products.js` | Already the real store. For live stock, swap the generated array for a Storefront API fetch — same shape |
| Newsletter | `Newsletter.jsx`, `submit()` | Point at Klaviyo/Mailchimp; the optimistic UI is already there |

Prices are plain numbers in USD, matching the store (`money()` in
`store/cart.jsx`) — swap that one helper for `Intl.NumberFormat` if you ever need
LBP or multi-currency.
