#!/usr/bin/env node
/**
 * Re-pull the catalogue from the live Shopify storefront.
 *
 *   npm run catalogue
 *
 * Reads /products.json and each collection's products.json, then rewrites
 * src/data/products.js. Nothing is invented: prices, sizes, colours and
 * copy come from the store. Run it whenever the shop changes.
 */

import { writeFile } from 'node:fs/promises';

const SHOP = process.env.FDM_SHOP ?? 'https://folliesdapresmidi.com';
const COLLECTIONS = {
  bottoms: 'Bottoms', bracelets: 'Bracelets', bralettes: 'Bralettes', 'co-ords': 'Co-ords',
  dresses: 'Dresses', earrings: 'Earrings', jackets: 'Jackets', necklaces: 'Necklaces',
  overalls: 'Overalls', tops: 'Tops',
};
const DROP_HANDLE = 'frontpage';
const DROP_NAME = 'Échappée 4 à 7';
const ORDER = ['Dresses', 'Co-ords', 'Jackets', 'Overalls', 'Tops', 'Bralettes', 'Bottoms', 'Necklaces', 'Earrings', 'Bracelets'];

const UA = { headers: { 'user-agent': 'Mozilla/5.0 (fdm-site catalogue sync)' } };

const get = async (path) => {
  const res = await fetch(`${SHOP}${path}`, UA);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
};

const strip = (html) => (html ?? '')
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&#39;|&rsquo;/g, '’').replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ').trim();

const sized = (src, w) => `${src.split('?')[0]}?width=${w}`;

const main = async () => {
  const all = [];
  for (let page = 1; page <= 10; page += 1) {
    const { products } = await get(`/products.json?limit=250&page=${page}`);
    if (!products.length) break;
    all.push(...products);
  }

  const line = {};
  for (const [handle, label] of Object.entries(COLLECTIONS)) {
    const { products } = await get(`/collections/${handle}/products.json?limit=250`);
    products.forEach((p) => { line[p.handle] = label; });
  }
  const drop = new Set((await get(`/collections/${DROP_HANDLE}/products.json?limit=250`)).products.map((p) => p.handle));

  const products = all.map((p) => {
    const plain = p.variants.length === 1 && p.variants[0].title === 'Default Title';
    const variants = p.variants.map((v) => ({
      // Shopify variant id — a cart permalink is /cart/{id}:{qty}
      id: v.id,
      size: plain ? 'One size' : (v.option1 ?? '').trim(),
      colour: (v.option2 ?? '').trim() || null,
      price: parseFloat(v.price),
      available: Boolean(v.available),
    }));
    return {
      id: p.handle,
      name: p.title.trim(),
      line: line[p.handle] ?? 'Objects',
      price: Math.min(...variants.map((v) => v.price)),
      images: p.images.slice(0, 4).map((i) => sized(i.src, 1400)),
      sizes: [...new Set(variants.map((v) => v.size))],
      colours: [...new Set(variants.map((v) => v.colour).filter(Boolean))],
      variants,
      note: strip(p.body_html),
      drop: drop.has(p.handle),
      available: variants.some((v) => v.available),
      url: `${SHOP}/products/${p.handle}`,
    };
  }).sort((a, b) => {
    if (a.drop !== b.drop) return a.drop ? -1 : 1;
    return (ORDER.indexOf(a.line) - ORDER.indexOf(b.line)) || b.price - a.price;
  });

  // JSON is valid JS; only the keys are unquoted, for readability.
  const body = JSON.stringify(products, null, 2)
    .replace(/^(\s*)"([A-Za-z_$][\w$]*)":/gm, '$1$2:')
    .replace(/"/g, "'");

  const file = `/**
 * ─────────────────────────────────────────────────────────────
 *  CATALOGUE — Follies d'Après-Midi
 * ─────────────────────────────────────────────────────────────
 *  GENERATED — do not hand-edit. Run \`npm run catalogue\` to refresh
 *  from ${SHOP}/products.json.
 *
 *  Last pulled ${new Date().toISOString().slice(0, 10)} · ${products.length} products · prices in USD.
 *  Imagery is served by the store's own CDN, which resizes on request
 *  (the ?width= parameter).
 *
 *  Products sold as a single "Default Title" variant are listed as
 *  One size, which is how the store sells them.
 */

export const PRODUCTS = ${body};

/** Filter bar — the store's own collections, with the three accessory
 *  collections grouped under one heading. */
export const CATEGORIES = [
  { label: 'All', lines: null },
  { label: 'Dresses', lines: ['Dresses'] },
  { label: 'Co-ords', lines: ['Co-ords'] },
  { label: 'Tops', lines: ['Tops'] },
  { label: 'Bralettes', lines: ['Bralettes'] },
  { label: 'Bottoms', lines: ['Bottoms'] },
  { label: 'Jackets', lines: ['Jackets'] },
  { label: 'Overalls', lines: ['Overalls'] },
  { label: 'Jewellery', lines: ['Necklaces', 'Earrings', 'Bracelets'] },
];

/** The current drop, as named on the storefront. */
export const DROP = ${JSON.stringify(DROP_NAME)};

/** Pop-ups announced on @folliesdapresmidi. */
export const POPUPS = [
  { place: 'Beit Misk', city: 'Mount Lebanon', dates: '04 — 06 September', time: 'From 16:00', status: 'open' },
  { place: 'Soul Beach', city: 'Batroun', dates: '15 September', time: 'From 10:00', status: 'open' },
  { place: 'Emergency Room', city: 'Beirut', dates: '09 July', time: 'Archive', status: 'past' },
];
`;

  await writeFile(new URL('../src/data/products.js', import.meta.url), file);
  console.log(`✓ ${products.length} products → src/data/products.js`);
  console.log(`  ${products.filter((p) => p.drop).length} in ${DROP_NAME}`);
  console.log(`  ${products.filter((p) => p.sizes[0] !== 'One size').length} with sizes, ${products.filter((p) => p.colours.length).length} with colours`);
  const missing = products.filter((p) => !p.note).map((p) => p.name);
  if (missing.length) console.log(`  note: no description on ${missing.length} (${missing.join(', ')})`);
};

main().catch((err) => { console.error('✗', err.message); process.exit(1); });
