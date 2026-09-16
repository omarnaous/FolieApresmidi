import { AdminProductInput } from '../../shared/api';
import { parseMoney } from '../../shared/money';
import { createDb } from '../db/client';
import { csvRecords } from '../lib/csv';
import { ulid } from '../lib/ids';
import { errorFields, log } from '../lib/log';
import { saveProductCore } from '../services/admin-products';
import { getSettings } from '../services/settings';

const bool = (v: string | undefined, fallback: boolean) => (v === undefined || v === '' ? fallback : /^(true|1|yes)$/i.test(v));
const int = (v: string | undefined) => (v === undefined || v === '' ? null : Number.parseInt(v, 10));

/** Find or create a media row for an image URL from the CSV (fetched into R2 lazily on first view). */
async function mediaFor(d1: D1Database, src: string, appUrl: string, alt: string): Promise<string | null> {
  const ours = src.startsWith(`${appUrl}/media/`) ? src.slice(`${appUrl}/media/`.length) : src.startsWith('/media/') ? src.slice('/media/'.length) : null;
  if (ours) {
    const row = await d1.prepare('SELECT id FROM media WHERE r2_key = ?').bind(ours.split('?')[0]).first<{ id: string }>();
    return row?.id ?? null;
  }
  if (!/^https:\/\//i.test(src)) return null;
  const existing = await d1.prepare('SELECT id FROM media WHERE source_url = ?').bind(src).first<{ id: string }>();
  if (existing) return existing.id;
  const id = ulid();
  const ext = /\.(jpe?g|png|webp|avif|gif)(\?|$)/i.exec(src)?.[1]?.toLowerCase().replace('jpeg', 'jpg') ?? 'jpg';
  await d1
    .prepare('INSERT INTO media (id, r2_key, source_url, mime, bytes, width, height, alt, created_by, created_at) VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, ?)')
    .bind(id, `products/imported/${id.toLowerCase()}.${ext}`, src, `image/${ext === 'jpg' ? 'jpeg' : ext}`, alt.slice(0, 300), Date.now())
    .run();
  return id;
}

/**
 * Import products from a Shopify-style CSV: one row per variant and/or image,
 * grouped by Handle. Existing products (matched by handle) are updated and keep
 * their variant ids where the option values match. Row errors are collected;
 * one bad product never stops the rest.
 */
export async function runCsvImport(env: Env, importId: string): Promise<void> {
  const d1 = env.DB;
  const job = await d1.prepare('SELECT * FROM csv_imports WHERE id = ?').bind(importId).first<{ id: string; r2_key: string; status: string; staff_id: string | null }>();
  if (!job || job.status === 'completed' || job.status === 'failed') return;
  await d1.prepare(`UPDATE csv_imports SET status = 'processing' WHERE id = ?`).bind(importId).run();

  const errors: { row: number; message: string }[] = [];
  const summary = { created: 0, updated: 0, skipped: 0, rows: 0 };
  try {
    const object = await env.MEDIA.get(job.r2_key);
    if (!object) throw new Error('The uploaded file is missing');
    const settings = await getSettings(createDb(d1));
    const records = csvRecords(await object.text());
    summary.rows = records.length;

    const groups = new Map<string, { row: number; r: Record<string, string> }[]>();
    records.forEach((r, i) => {
      const handle = (r.Handle ?? '').trim().toLowerCase();
      if (!handle) {
        errors.push({ row: i + 2, message: 'Missing Handle' });
        return;
      }
      groups.set(handle, [...(groups.get(handle) ?? []), { row: i + 2, r }]);
    });

    for (const [handle, rows] of groups) {
      const firstRow = rows[0]!;
      const head = firstRow.r;
      try {
        const existing = await d1.prepare('SELECT id FROM products WHERE handle = ?').bind(handle).first<{ id: string }>();
        const priorVariants = existing
          ? (await d1.prepare('SELECT id, option1, option2, option3 FROM variants WHERE product_id = ?').bind(existing.id).all<{ id: string; option1: string | null; option2: string | null; option3: string | null }>()).results
          : [];

        const optionNames = [head['Option1 Name'], head['Option2 Name'], head['Option3 Name']].filter((n): n is string => !!n && n !== 'Title');
        const variantRows = rows.filter(({ r }) => r['Variant Price'] || r['Option1 Value']);
        const values = optionNames.map((_, i) => [...new Set(variantRows.map(({ r }) => r[`Option${i + 1} Value`]).filter(Boolean))]);

        const variants = variantRows.map(({ r, row }) => {
          const opts = optionNames.map((_, i) => r[`Option${i + 1} Value`] ?? '');
          const price = parseMoney(r['Variant Price'] ?? '', settings.currency);
          if (price === null) throw new Error(`Row ${row}: "${r['Variant Price']}" is not a price`);
          const compare = r['Variant Compare At Price'] ? parseMoney(r['Variant Compare At Price'], settings.currency) : null;
          const prior = priorVariants.find((v) => [v.option1, v.option2, v.option3].slice(0, opts.length).every((o, i) => (o ?? '') === opts[i]));
          return {
            ...(prior ? { id: prior.id } : {}),
            sku: r['Variant SKU'] || null,
            options: opts,
            price,
            compareAtPrice: compare && compare > price ? compare : null,
            costPrice: null,
            weightGrams: int(r['Variant Weight Grams']) ?? 0,
            requiresShipping: bool(r['Variant Requires Shipping'], true),
            taxable: bool(r['Variant Taxable'], true),
            inventoryTracked: bool(r['Variant Inventory Tracked'], true),
            inventoryPolicy: r['Variant Inventory Policy'] === 'continue' ? 'continue' : 'deny',
            inventoryOnHand: Math.max(0, int(r['Variant Inventory Qty']) ?? 0),
            imageId: null,
          };
        });

        const mediaIds: string[] = [];
        for (const { r } of rows.filter(({ r }) => r['Image Src']).sort((a, b) => (int(a.r['Image Position']) ?? 0) - (int(b.r['Image Position']) ?? 0))) {
          const id = await mediaFor(d1, r['Image Src']!, env.APP_URL, r['Image Alt Text'] || head.Title || handle);
          if (id && !mediaIds.includes(id)) mediaIds.push(id);
        }

        const status = (head.Status || 'draft').toLowerCase();
        const parsed = AdminProductInput.safeParse({
          title: head.Title,
          handle,
          descriptionHtml: head['Body (HTML)'] ?? '',
          status: ['active', 'draft', 'archived'].includes(status) ? status : 'draft',
          productType: head.Type ?? '',
          vendor: head.Vendor || null,
          tags: (head.Tags ?? '').split(',').map((t) => t.trim()).filter(Boolean),
          seoTitle: head['SEO Title'] || null,
          seoDescription: head['SEO Description'] || null,
          options: optionNames.map((name, i) => ({ name, values: (values[i] ?? []).map((value) => ({ value })) })),
          variants,
          mediaIds,
          collectionIds: [],
        });
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          throw new Error(`${issue?.path.join('.') || 'product'}: ${issue?.message ?? 'invalid'}`);
        }
        await saveProductCore(d1, existing?.id ?? null, parsed.data, job.staff_id, 'import');
        if (existing) summary.updated += 1;
        else summary.created += 1;
      } catch (err) {
        summary.skipped += 1;
        errors.push({ row: firstRow.row, message: `${handle}: ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    await d1
      .prepare(`UPDATE csv_imports SET status = 'completed', summary_json = ?, errors_json = ?, finished_at = ? WHERE id = ?`)
      .bind(JSON.stringify(summary), JSON.stringify(errors.slice(0, 200)), Date.now(), importId)
      .run();
    log.info('csv_import_done', { importId, ...summary, errors: errors.length });
  } catch (err) {
    log.error('csv_import_failed', { importId, ...errorFields(err) });
    await d1
      .prepare(`UPDATE csv_imports SET status = 'failed', summary_json = ?, errors_json = ?, finished_at = ? WHERE id = ?`)
      .bind(JSON.stringify(summary), JSON.stringify([...errors, { row: 0, message: err instanceof Error ? err.message : String(err) }].slice(0, 200)), Date.now(), importId)
      .run();
  }
}
