#!/usr/bin/env node
/**
 * Pull every seed product image out of the store's Shopify CDN and into R2,
 * under the exact keys the catalogue seed records
 * (products/seed/<product>-<n>.<ext>) — so the shop serves its own copies and
 * can leave Shopify without a single image breaking.
 *
 *   node scripts/migrate-images-to-r2.mjs [bucket]     (default bucket: fdm-media)
 *
 * Prerequisites, on the logged-in Cloudflare account:
 *   - R2 enabled (dashboard, one-time)
 *   - the bucket exists:  wrangler r2 bucket create <bucket>
 *
 * Re-running is safe: it overwrites the same keys with the same bytes.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PRODUCTS } from './seed-data/shopify-products.js';

const run = promisify(execFile);
const BUCKET = process.argv[2] || 'fdm-media';
const WRANGLER = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));

const mimeFor = (ext) => (ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');

// the same key + source rules build-seed.mjs writes into the media table
const jobs = [];
for (const p of PRODUCTS) {
  p.images.forEach((src, i) => {
    const url = src.split('?')[0];
    const ext = (/\.(jpe?g|png|webp)$/i.exec(url)?.[1] ?? 'jpg').toLowerCase().replace('jpeg', 'jpg');
    jobs.push({ key: `products/seed/${p.id}-${i}.${ext}`, url: `${url}?width=2000`, mime: mimeFor(ext) });
  });
}

console.log(`Migrating ${jobs.length} images → R2 bucket "${BUCKET}"\n`);
const dir = await mkdtemp(join(tmpdir(), 'fdm-img-'));
let ok = 0;
let fail = 0;
let bytes = 0;

try {
  for (const [n, job] of jobs.entries()) {
    const tag = `[${String(n + 1).padStart(3)}/${jobs.length}] ${job.key}`;
    try {
      const res = await fetch(job.url);
      if (!res.ok) throw new Error(`source ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const file = join(dir, `img-${n}`);
      await writeFile(file, buf);
      await run(
        process.execPath,
        [WRANGLER, 'r2', 'object', 'put', `${BUCKET}/${job.key}`, '--file', file, '--content-type', job.mime, '--remote'],
        { maxBuffer: 1 << 25 },
      );
      ok += 1;
      bytes += buf.length;
      console.log(`✓ ${tag}  ${(buf.length / 1024).toFixed(0)} KB`);
    } catch (e) {
      fail += 1;
      console.error(`✗ ${tag}  — ${e.message}`);
    }
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(`\nDone: ${ok} uploaded (${(bytes / 1024 / 1024).toFixed(1)} MB), ${fail} failed, into "${BUCKET}".`);
process.exit(fail ? 1 : 0);
