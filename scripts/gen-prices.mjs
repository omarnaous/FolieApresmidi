#!/usr/bin/env node
/**
 * Write worker/catalogue.js from src/data/products.js.
 *
 *   node scripts/gen-prices.mjs
 *
 * The Worker prices every order from this file, never from the request, so
 * a tampered basket cannot set its own total. Run it after `npm run
 * catalogue` — the pull script already calls it.
 */
import { writeFile } from 'node:fs/promises';
import { PRODUCTS } from '../src/data/products.js';

const entries = PRODUCTS
  .map((p) => [p.id, Math.round(p.price * 100)])
  .sort((a, b) => a[0].localeCompare(b[0]));

const body = entries.map(([id, cents]) => `  ${JSON.stringify(id)}: ${cents},`).join('\n');

await writeFile(
  new URL('../worker/catalogue.js', import.meta.url),
  `/**
 * GENERATED — do not hand-edit. Run \`node scripts/gen-prices.mjs\`
 * (or \`npm run catalogue\`, which calls it) to refresh.
 *
 * Product id -> price in cents. The Worker prices orders from this and
 * ignores whatever total the browser claims.
 *
 * ${entries.length} products.
 */
export const PRICES = {
${body}
};
`,
);
console.log(`worker/catalogue.js — ${entries.length} products`);
