import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AdminCollectionDTO, AdminHomeDTO, InventoryRowDTO, Page, AdminOrderDTO, AdminProductDTO, AdminSessionDTO, HomeInput, LookDTO, OrderDTO, ProductListDTO, SettingsDTO, SettingsInput, SiteFileDTO, StaffInviteResultDTO, StoreDTO } from '../../shared/api';
import { listDevMail } from '../../worker/email/send';
import { runJob } from '../../worker/jobs/queue';
import { createProduct, readyCheckout, Shopper, stockOf, storeBasics } from '../helpers';

let owner: Shopper;

beforeAll(async () => {
  await storeBasics({ holdMinutes: 15 });
  owner = new Shopper();
  const wrong = await owner.json('POST', '/api/admin/auth/setup', { setupToken: 'nope', email: 'owner@example.com', name: 'Owner', password: 'owner password 1' });
  expect(wrong.status).toBe(403);
  const setup = await owner.json<AdminSessionDTO>('POST', '/api/admin/auth/setup', { setupToken: 'test-setup-token', email: 'owner@example.com', name: 'Owner', password: 'owner password 1' });
  expect(setup.status).toBe(201);
  expect(setup.data.staff?.role).toBe('owner');
});

describe('admin access', () => {
  it('allows setup only once', async () => {
    const again = await new Shopper().json('POST', '/api/admin/auth/setup', { setupToken: 'test-setup-token', email: 'second@example.com', name: 'Second', password: 'owner password 2' });
    expect(again.status).toBe(409);
  });

  it('requires a staff session', async () => {
    expect((await new Shopper().json('GET', '/api/admin/orders')).status).toBe(401);
    // a storefront session is not a staff session
    const shopper = new Shopper();
    await shopper.json('GET', '/api/auth/session');
    expect((await shopper.json('GET', '/api/admin/orders')).status).toBe(401);
  });

  it('signs staff in with their email and password', async () => {
    const staff = new Shopper();
    const wrong = await staff.json('POST', '/api/admin/auth/login', { email: 'owner@example.com', password: 'not the password' });
    expect(wrong.status).toBe(401);
    const ok = await staff.json<AdminSessionDTO>('POST', '/api/admin/auth/login', { email: 'owner@example.com', password: 'owner password 1' });
    expect(ok.status).toBe(200);
    expect(ok.data.staff?.email).toBe('owner@example.com');
    expect((await staff.json('GET', '/api/admin/orders')).status).toBe(200);
    // signed in to the admin is still nobody on the storefront
    expect(Object.keys((await staff.json('GET', '/api/auth/session')).data)).toEqual(['csrfToken']);
  });

  it('limits invited staff to their permissions', async () => {
    const invite = await owner.json<StaffInviteResultDTO>('POST', '/api/admin/staff/invite', { email: 'packer@example.com', name: 'Packer', role: 'staff', permissions: ['orders:read'] });
    expect(invite.status).toBe(201);
    const token = new URL(invite.data.inviteUrl!).searchParams.get('token')!;

    const staff = new Shopper();
    const accepted = await staff.json<AdminSessionDTO>('POST', '/api/admin/auth/accept-invite', { token, name: 'Packer', password: 'packer password' });
    expect(accepted.status).toBe(200);
    expect(accepted.data.staff?.permissions).toEqual(['orders:read']);

    expect((await staff.json('GET', '/api/admin/orders')).status).toBe(200);
    expect((await staff.json('GET', '/api/admin/products')).status).toBe(403);
    expect((await staff.json('GET', '/api/admin/staff')).status).toBe(403);

    // disabling signs them out at once
    await owner.json('PATCH', `/api/admin/staff/${accepted.data.staff!.id}`, { status: 'disabled' });
    expect((await staff.json('GET', '/api/admin/orders')).status).toBe(401);
  });

  /**
   * Nobody hands out authority they do not hold. Without this, the single
   * permission needed to manage the team was the only one worth stealing:
   * invite a second account carrying everything, accept your own invitation,
   * and walk back in with refunds, discounts and the customer list.
   */
  it('will not let staff give out permissions they do not have themselves', async () => {
    const invite = await owner.json<StaffInviteResultDTO>('POST', '/api/admin/staff/invite', {
      email: 'manager@example.com',
      name: 'Manager',
      role: 'staff',
      permissions: ['staff:manage'],
    });
    expect(invite.status).toBe(201);
    const token = new URL(invite.data.inviteUrl!).searchParams.get('token')!;
    const manager = new Shopper();
    const session = await manager.json<AdminSessionDTO>('POST', '/api/admin/auth/accept-invite', { token, name: 'Manager', password: 'manager password' });
    expect(session.data.staff?.permissions).toEqual(['staff:manage']);

    // the escalation: invite a second account holding everything
    const grab = await manager.json('POST', '/api/admin/staff/invite', {
      email: 'me@attacker.example',
      name: 'Ops',
      role: 'staff',
      permissions: ['orders:refund', 'discounts:write', 'settings:write', 'customers:read'],
    });
    expect(grab.status).toBe(403);
    expect(grab.data.error.message).toContain('permissions you do not have');

    // nor by editing somebody who already exists
    const packer = await owner.json<StaffInviteResultDTO>('POST', '/api/admin/staff/invite', {
      email: 'packer2@example.com', name: 'Packer', role: 'staff', permissions: ['orders:read'],
    });
    const lateral = await manager.json('PATCH', `/api/admin/staff/${packer.data.staff.id}`, {
      permissions: ['orders:read', 'orders:refund'],
    });
    expect(lateral.status).toBe(403);

    // what they do hold, they may pass on
    const fine = await manager.json('POST', '/api/admin/staff/invite', {
      email: 'peer@example.com', name: 'Peer', role: 'staff', permissions: ['staff:manage'],
    });
    expect(fine.status).toBe(201);

    // and the owner is unrestricted
    const byOwner = await owner.json('POST', '/api/admin/staff/invite', {
      email: 'trusted@example.com', name: 'Trusted', role: 'staff', permissions: ['orders:refund', 'settings:write'],
    });
    expect(byOwner.status).toBe(201);
  });
});

describe('admin catalog', () => {
  it('creates a product the storefront can sell, with sanitised copy', async () => {
    const created = await owner.json<AdminProductDTO>('POST', '/api/admin/products', {
      title: 'La robe',
      status: 'active',
      descriptionHtml: '<p onclick="steal()">Silk <script>alert(1)</script><a href="javascript:alert(1)">x</a></p>',
      options: [{ name: 'Size', values: [{ value: 'S' }, { value: 'M' }] }],
      variants: [
        { options: ['S'], price: 12_000, inventoryOnHand: 2 },
        { options: ['M'], price: 12_000, inventoryOnHand: 0 },
      ],
    });
    expect(created.status).toBe(201);
    expect(created.data.descriptionHtml).toBe('<p>Silk <a>x</a></p>');
    expect(created.data.handle).toBe('la-robe');

    const store = await new Shopper().json('GET', '/api/products/la-robe');
    expect(store.status).toBe(200);
    expect(store.data.variants.map((v: { available: boolean }) => v.available)).toEqual([true, false]);

    const history = await owner.json('GET', `/api/admin/variants/${created.data.variants[0]!.id}/inventory`);
    expect(history.data.items[0]?.delta).toBe(2);

    const draft = await owner.json('POST', '/api/admin/products/bulk', { ids: [created.data.id], action: 'draft' });
    expect(draft.status).toBe(200);
    expect((await new Shopper().json('GET', '/api/products/la-robe')).status).toBe(404);
  });

  it('pairs pieces for shop the look, and suggests some when none are paired', async () => {
    const dress = await createProduct({ title: 'Look dress', productType: 'Dresses' });
    const necklace = await createProduct({ title: 'Look necklace', productType: 'Jewellery' });
    const jacket = await createProduct({ title: 'Look jacket', productType: 'Jackets' });
    const lookOf = (handle: string) => new Shopper().json<LookDTO>('GET', `/api/products/${handle}/look`);

    // nothing paired: suggestions, never the piece itself, another category first
    const suggested = await lookOf(dress.handle);
    expect(suggested.status).toBe(200);
    expect(suggested.data.curated).toBe(false);
    expect(suggested.data.items.length).toBeGreaterThan(0);
    expect(suggested.data.items.some((p) => p.id === dress.id)).toBe(false);
    expect(suggested.data.items[0]!.productType).not.toBe('Dresses');

    // the editor's full body for this dress, with a look
    const body = (lookProductIds?: string[]) => ({
      title: dress.title,
      handle: dress.handle,
      status: 'active',
      productType: dress.productType,
      options: dress.options.map((o) => ({ name: o.name, values: o.values.map((v) => ({ value: v.value })) })),
      variants: dress.variants.map((v) => ({ id: v.id, options: v.options, price: v.price, inventoryOnHand: v.inventoryOnHand })),
      lookProductIds,
    });
    const put = (lookProductIds?: string[]) => owner.json<AdminProductDTO>('PUT', `/api/admin/products/${dress.id}`, body(lookProductIds));

    const saved = await put([jacket.id, necklace.id]);
    expect(saved.status).toBe(200);
    expect(saved.data.look.map((p) => [p.title, p.status])).toEqual([['Look jacket', 'active'], ['Look necklace', 'active']]);

    const curated = await lookOf(dress.handle);
    expect(curated.data.curated).toBe(true);
    expect(curated.data.items.map((p) => p.title)).toEqual(['Look jacket', 'Look necklace']);

    // bad looks are refused against the field
    for (const ids of [[dress.id], [necklace.id, necklace.id], ['no-such-piece']]) {
      const refused = await owner.json('PUT', `/api/admin/products/${dress.id}`, body(ids));
      expect(refused.status).toBe(422);
      expect(refused.data.error.fields.lookProductIds).toBeTruthy();
    }

    // a save that leaves the look out keeps it
    expect((await put(undefined)).data.look).toHaveLength(2);

    // a piece taken off sale drops out of the store's look, not the admin's
    await owner.json('POST', '/api/admin/products/bulk', { ids: [jacket.id], action: 'draft' });
    expect((await lookOf(dress.handle)).data.items.map((p) => p.title)).toEqual(['Look necklace']);
    expect((await owner.json<AdminProductDTO>('GET', `/api/admin/products/${dress.id}`)).data.look.map((p) => p.status)).toEqual(['draft', 'active']);

    // a deleted piece leaves every look it was in
    expect((await owner.json('DELETE', `/api/admin/products/${necklace.id}`)).status).toBe(204);
    expect((await owner.json<AdminProductDTO>('GET', `/api/admin/products/${dress.id}`)).data.look.map((p) => p.title)).toEqual(['Look jacket']);
  });

  it('rejects invalid variants with field errors', async () => {
    const res = await owner.json('POST', '/api/admin/products', {
      title: 'Broken',
      options: [{ name: 'Size', values: [{ value: 'S' }] }],
      variants: [{ options: ['S'], price: 1000, compareAtPrice: 500 }, { options: ['S'], price: 1000 }],
    });
    expect(res.status).toBe(422);
    expect(res.data.error.fields['variants.0.compareAtPrice']).toBeTruthy();
    expect(res.data.error.fields['variants.1.options']).toBeTruthy();
  });
});

describe('admin orders', () => {
  it('fulfils, ships, delivers, collects cash and refunds', async () => {
    const product = await createProduct({ stock: [5, 5] });
    const s = new Shopper();
    const { checkout } = await readyCheckout(s, product.variants[0]!.id, 2);
    const placed = await s.json<{ order: OrderDTO }>('POST', `/api/checkout/${checkout!.id}/complete`, { paymentMethod: 'cod' });
    const id = placed.data.order.id;

    const step = (body: object) => owner.json<AdminOrderDTO>('POST', `/api/admin/orders/${id}/transition`, body);

    // nothing paid yet: refunds are refused, cancelling is the way out
    expect((await owner.json('POST', `/api/admin/orders/${id}/refunds`, { amount: 100 })).status).toBe(409);

    expect((await step({ to: 'fulfilled' })).data.status).toBe('fulfilled');
    const shipped = await step({ to: 'shipped', tracking: { carrier: 'Aramex', number: 'LB123', url: 'https://track.example/LB123' } });
    expect(shipped.data.fulfillments[0]?.trackingNumber).toBe('LB123');
    expect((await step({ to: 'cancelled' })).status).toBe(409);

    const delivered = await step({ to: 'delivered', markPaid: true });
    expect(delivered.data.status).toBe('delivered');
    expect(delivered.data.paymentStatus).toBe('paid');
    expect(delivered.data.refundableAmount).toBe(delivered.data.pricing.total);

    const partial = await owner.json<AdminOrderDTO>('POST', `/api/admin/orders/${id}/refunds`, {
      amount: 10_000,
      restock: true,
      lines: [{ orderLineId: delivered.data.lines[0]!.id, quantity: 1 }],
      reason: 'Wrong size',
    });
    expect(partial.status).toBe(200);
    expect(partial.data.paymentStatus).toBe('partially_refunded');
    expect(await env.DB.prepare('SELECT inventory_on_hand AS n FROM variants WHERE id = ?').bind(product.variants[0]!.id).first('n')).toBe(4);

    const tooMuch = await owner.json('POST', `/api/admin/orders/${id}/refunds`, { amount: partial.data.refundableAmount + 1 });
    expect(tooMuch.status).toBe(422);

    const rest = await owner.json<AdminOrderDTO>('POST', `/api/admin/orders/${id}/refunds`, { amount: partial.data.refundableAmount });
    expect(rest.data.status).toBe('refunded');
    expect(rest.data.paymentStatus).toBe('refunded');

    const types = rest.data.events.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['order_placed', 'status_changed', 'payment_captured', 'refund_issued']));
  });

  it('cancelling an unpaid order puts the stock back', async () => {
    const product = await createProduct({ stock: [3, 3] });
    const s = new Shopper();
    const { checkout } = await readyCheckout(s, product.variants[1]!.id, 3);
    const placed = await s.json<{ order: OrderDTO }>('POST', `/api/checkout/${checkout!.id}/complete`, { paymentMethod: 'cod' });
    const stock = () => env.DB.prepare('SELECT inventory_on_hand AS n FROM variants WHERE id = ?').bind(product.variants[1]!.id).first('n');
    expect(await stock()).toBe(0);
    const cancelled = await owner.json<AdminOrderDTO>('POST', `/api/admin/orders/${placed.data.order.id}/transition`, { to: 'cancelled', reason: 'Customer called', restock: true });
    expect(cancelled.data.status).toBe('cancelled');
    expect(await stock()).toBe(3);
  });

  it('reports the dashboard for a date range', async () => {
    const res = await owner.json('GET', `/api/admin/dashboard?from=${Date.now() - 86_400_000}&to=${Date.now() + 60_000}`);
    expect(res.status).toBe(200);
    expect(res.data.orders).toBeGreaterThanOrEqual(1);
    expect(res.data.series.length).toBeGreaterThanOrEqual(1);
  });
});

describe('home page content', () => {
  const sections = (label: string): HomeInput['sections'] => [
    { key: 'maison', label, navLabel: 'House' },
    { key: 'boutique', label: 'The boutique', navLabel: 'Boutique' },
    { key: 'accessories', label: 'Accessories', navLabel: 'Accessories' },
    { key: 'journal', label: 'Limited edition', navLabel: 'Edition' },
    { key: 'popups', label: 'Where to find us', navLabel: 'Find us' },
  ];
  const home = (floors: HomeInput['floors'], label = 'Maison FDM'): HomeInput => ({
    sections: sections(label),
    maison: { heading: 'Two floors, *one address*', intro: 'Take the lift.' },
    accessories: { heading: 'Small things, *said loudly*', intro: null },
    floors,
    ribbon: ['Épicée', 'Libre'],
    boutique: { heading: 'The drop', intro: 'Ten pieces.' },
    journal: { heading: 'Limited *quantities*', intro: 'Made in Lebanon.', buttonLabel: 'Find us', notebookMediaId: null },
    popups: { heading: 'Summer *pop-ups*', intro: 'No list.', rows: [{ place: 'Beit Misk', city: 'Mount Lebanon', dates: '04 — 06 September', time: 'From 16:00', status: 'open' }] },
    footer: { blurb: 'Made in limited quantities in Lebanon.', careNote: 'Exchanges within 24 hours.' },
  });

  it('serves the defaults until the owner saves', async () => {
    const store = await new Shopper().json<StoreDTO>('GET', '/api/store');
    expect(store.data.home.sections.map((s) => s.key)).toEqual(['maison', 'boutique', 'accessories', 'journal', 'popups']);
    // the copy the site ships with, until the owner writes their own
    expect(store.data.home.ribbon).toContain('Épicée');
    expect(store.data.home.popups.rows.length).toBeGreaterThan(0);
    expect(store.data.home.journal.intro).toContain('confidence');
    expect(store.data.home.footer.blurb).toContain('Lebanon');
    expect(store.data.home.hero.video).toBeNull();
    expect(store.data.home.journal.notebook).toBeNull();
    // every section is on the page until the owner switches one off
    expect(store.data.home.sections.every((s) => s.visible)).toBe(true);
    expect(store.data.home.accessories).toEqual({
      heading: 'Bold colour, *refined detail*',
      intro: 'Gold, stone and pearl — designed and produced in limited quantities in Lebanon.',
    });
    expect(store.data.home.sections[0]).toMatchObject({ label: 'Maison FDM', navLabel: 'Maison' });
    expect(store.data.home.floors.map((f) => f.name)).toEqual(['Tops', 'Bottoms', 'Bralettes', 'Accessories']);
  });

  it('switches a section off the page and back on', async () => {
    const hidden = sections('Maison FDM').map((s) => (s.key === 'popups' ? { ...s, visible: false } : s));
    const off = await owner.json<AdminHomeDTO>('PUT', '/api/admin/home', {
      ...home([{ name: 'Tops', collectionHandle: null, imageMediaId: null }]),
      sections: hidden,
    });
    expect(off.status).toBe(200);
    expect(off.data.sections.find((s) => s.key === 'popups')?.visible).toBe(false);
    expect(off.data.sections.filter((s) => s.visible)).toHaveLength(4);

    const store = await new Shopper().json<StoreDTO>('GET', '/api/store');
    expect(store.data.home.sections.find((s) => s.key === 'popups')?.visible).toBe(false);
    // the others are untouched
    expect(store.data.home.sections.filter((s) => s.key !== 'popups').every((s) => s.visible)).toBe(true);

    const on = await owner.json<AdminHomeDTO>('PUT', '/api/admin/home', home([{ name: 'Tops', collectionHandle: null, imageMediaId: null }]));
    expect(on.data.sections.every((s) => s.visible)).toBe(true);
  });

  it('saves every part of the page, and keeps the section order', async () => {
    const reordered = sections('Maison FDM').filter((s) => s.key !== 'popups');
    const saved = await owner.json<AdminHomeDTO>('PUT', '/api/admin/home', {
      ...home([{ name: 'Tops', collectionHandle: null, imageMediaId: null }]),
      // the pop-ups move to the front of the page
      sections: [sections('Maison FDM').find((s) => s.key === 'popups')!, ...reordered],
    });
    expect(saved.status).toBe(200);

    const store = await new Shopper().json<StoreDTO>('GET', '/api/store');
    expect(store.data.home.sections.map((s) => s.key)).toEqual(['popups', 'maison', 'boutique', 'accessories', 'journal']);
    expect(store.data.home.ribbon).toEqual(['Épicée', 'Libre']);
    expect(store.data.home.boutique).toEqual({ heading: 'The drop', intro: 'Ten pieces.' });
    expect(store.data.home.journal).toMatchObject({ heading: 'Limited *quantities*', buttonLabel: 'Find us', notebook: null });
    expect(store.data.home.popups.rows[0]).toEqual({ place: 'Beit Misk', city: 'Mount Lebanon', dates: '04 — 06 September', time: 'From 16:00', status: 'open' });
    expect(store.data.home.footer.careNote).toBe('Exchanges within 24 hours.');

    // back the way it was, so the tests after this one read the usual page
    await owner.json('PUT', '/api/admin/home', home([{ name: 'Tops', collectionHandle: null, imageMediaId: null }]));
  });

  it('takes an MP4 and a PDF for the film and the notebook, and refuses anything else', async () => {
    // the bytes are what is checked, never the name or the declared type
    const mp4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
    const pdf = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer<<>>');

    const send = (bytes: Uint8Array, name: string, type: string) => {
      const fd = new FormData();
      fd.append('file', new File([bytes], name, { type }));
      return owner.json<SiteFileDTO>('POST', '/api/admin/site-files', fd);
    };

    const film = await send(mp4, 'campaign.mp4', 'video/mp4');
    expect(film.status).toBe(201);
    expect(film.data).toMatchObject({ mime: 'video/mp4', name: 'campaign.mp4', bytes: mp4.byteLength });
    const notebook = await send(pdf, 'notebook.pdf', 'application/pdf');
    expect(notebook.status).toBe(201);
    expect(notebook.data.mime).toBe('application/pdf');

    // a file pretending to be a film is refused on its bytes
    const fd = new FormData();
    fd.append('file', new File([new TextEncoder().encode('just text')], 'sneaky.mp4', { type: 'video/mp4' }));
    const liar = await owner.json('POST', '/api/admin/site-files', fd);
    expect(liar.status).toBe(422);
    expect(liar.data.error.fields.file).toBeTruthy();

    const saved = await owner.json<AdminHomeDTO>('PUT', '/api/admin/home', {
      ...home([{ name: 'Tops', collectionHandle: null, imageMediaId: null }]),
      hero: { videoMediaId: film.data.id },
      journal: { heading: 'H', intro: 'I', buttonLabel: 'B', notebookMediaId: notebook.data.id },
    });
    expect(saved.status).toBe(200);
    expect(saved.data.hero.video?.url).toBe(film.data.url);

    const store = await new Shopper().json<StoreDTO>('GET', '/api/store');
    expect(store.data.home.hero.video?.url).toBe(film.data.url);
    expect(store.data.home.journal.notebook?.alt).toBe('notebook.pdf');

    // the film is served with byte ranges, or Safari will not play it
    const ranged = await new Shopper().request('GET', film.data.url, undefined, { range: 'bytes=0-7' });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-range')).toBe(`bytes 0-7/${mp4.byteLength}`);
    expect(ranged.headers.get('accept-ranges')).toBe('bytes');

    await owner.json('PUT', '/api/admin/home', home([{ name: 'Tops', collectionHandle: null, imageMediaId: null }]));
  });

  it('refuses a film or a notebook that is not there', async () => {
    const res = await owner.json('PUT', '/api/admin/home', {
      ...home([{ name: 'Tops', collectionHandle: null, imageMediaId: null }]),
      hero: { videoMediaId: 'no-such-video' },
      journal: { heading: 'H', intro: 'I', buttonLabel: 'B', notebookMediaId: 'no-such-pdf' },
    });
    expect(res.status).toBe(422);
    expect(res.data.error.fields['hero.videoMediaId']).toBeTruthy();
    expect(res.data.error.fields['journal.notebookMediaId']).toBeTruthy();
  });

  it('is only for staff who manage settings', async () => {
    expect((await new Shopper().json('GET', '/api/admin/home')).status).toBe(401);
    expect((await new Shopper().json('PUT', '/api/admin/home', home([{ name: 'Tops', collectionHandle: null, imageMediaId: null }]))).status).toBe(401);
  });

  it('refuses floors that point at nothing', async () => {
    const res = await owner.json('PUT', '/api/admin/home', home([
      { name: 'Tops', collectionHandle: 'no-such-collection', imageMediaId: null },
      { name: 'Bottoms', collectionHandle: null, imageMediaId: 'no-such-image' },
    ]));
    expect(res.status).toBe(422);
    expect(Object.keys(res.data.error.fields)).toEqual(expect.arrayContaining(['floors.0.collectionHandle', 'floors.1.imageMediaId']));
    const empty = await owner.json('PUT', '/api/admin/home', home([]));
    expect(empty.status).toBe(422);
  });

  it('saves names and floors, and pictures a floor from its collection', async () => {
    const product = await createProduct();
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO media (id, r2_key, mime, alt, created_at) VALUES ('m-cover', 'products/test/cover.jpg', 'image/jpeg', 'Cover', ?)`).bind(now),
      env.DB.prepare(`INSERT INTO media (id, r2_key, mime, alt, created_at) VALUES ('m-chosen', 'brand/floor.jpg', 'image/jpeg', 'Chosen', ?)`).bind(now),
      env.DB.prepare(`INSERT INTO product_media (product_id, media_id, position) VALUES (?, 'm-cover', 0)`).bind(product.id),
      env.DB.prepare(`INSERT INTO collections (id, handle, title, type, created_at, updated_at) VALUES ('col-floor', 'floor-tops', 'Floor tops', 'manual', ?, ?)`).bind(now, now),
      env.DB.prepare(`INSERT INTO collection_products (collection_id, product_id, position) VALUES ('col-floor', ?, 0)`).bind(product.id),
    ]);

    const saved = await owner.json<AdminHomeDTO>('PUT', '/api/admin/home', home([
      { name: 'Tops', line: 'First floor', collectionHandle: 'floor-tops', imageMediaId: null },
      { name: 'Everything', collectionHandle: null, imageMediaId: 'm-chosen' },
    ], 'La Maison'));
    expect(saved.status).toBe(200);
    // the admin sees what was chosen, and separately what shows without it
    expect(saved.data.floors[0]).toMatchObject({ name: 'Tops', image: null, fallback: { id: 'm-cover' } });
    expect(saved.data.floors[1]).toMatchObject({ image: { id: 'm-chosen' }, fallback: null });

    const store = await new Shopper().json<StoreDTO>('GET', '/api/store');
    expect(store.data.home.sections[0]).toMatchObject({ key: 'maison', label: 'La Maison', navLabel: 'House' });
    expect(store.data.home.maison).toEqual({ heading: 'Two floors, *one address*', intro: 'Take the lift.' });
    // an empty subtitle is stored as none
    expect(store.data.home.accessories).toEqual({ heading: 'Small things, *said loudly*', intro: null });
    expect(store.data.home.floors).toEqual([
      { name: 'Tops', line: 'First floor', collectionHandle: 'floor-tops', image: expect.objectContaining({ id: 'm-cover', url: '/media/products/test/cover.jpg' }) },
      { name: 'Everything', line: null, collectionHandle: null, image: expect.objectContaining({ id: 'm-chosen' }) },
    ]);

    const again = await owner.json<AdminHomeDTO>('GET', '/api/admin/home');
    expect(again.data.sections[0]!.label).toBe('La Maison');
    expect(again.data.floors).toHaveLength(2);
  });
});

describe('inventory', () => {
  it('lists the stock of every piece, and saves several counts at once', async () => {
    const product = await createProduct({ title: 'Stock piece', stock: [4, 0] });
    const [small, medium] = product.variants;

    const all = await owner.json<Page<InventoryRowDTO>>('GET', '/api/admin/inventory?q=Stock%20piece');
    expect(all.status).toBe(200);
    expect(all.data.items.map((r) => [r.variantTitle, r.onHand])).toEqual([
      [small!.title, 4],
      [medium!.title, 0],
    ]);

    // the sold-out filter finds the one with nothing left
    const out = await owner.json<Page<InventoryRowDTO>>('GET', '/api/admin/inventory?q=Stock%20piece&show=out');
    expect(out.data.items.map((r) => r.variantTitle)).toEqual([medium!.title]);

    const saved = await owner.json<{ items: InventoryRowDTO[] }>('POST', '/api/admin/inventory', {
      items: [
        { variantId: small!.id, onHand: 2, baseline: 4 },
        { variantId: medium!.id, onHand: 6, baseline: 0 },
      ],
    });
    expect(saved.status).toBe(200);
    expect(saved.data.items.map((r) => r.onHand).sort()).toEqual([2, 6]);
    expect(await stockOf(small!.id)).toBe(2);
    expect(await stockOf(medium!.id)).toBe(6);

    /* A sale while the screen was open: the count it saw is stale, so only the
       change the owner made is applied — the sale is not undone. */
    await owner.json('POST', `/api/admin/variants/${small!.id}/inventory`, { mode: 'adjust', quantity: -1 });
    const late = await owner.json<{ items: InventoryRowDTO[] }>('POST', '/api/admin/inventory', {
      items: [{ variantId: small!.id, onHand: 5, baseline: 2 }],
    });
    expect(late.data.items[0]!.onHand).toBe(4);

    // and stock is never allowed below zero
    const under = await owner.json('POST', '/api/admin/inventory', { items: [{ variantId: small!.id, onHand: 0, baseline: 100 }] });
    expect(under.status).toBe(422);
    expect(await stockOf(small!.id)).toBe(4);
  });

  it('is only for staff who manage products', async () => {
    expect((await new Shopper().json('GET', '/api/admin/inventory')).status).toBe(401);
    expect((await new Shopper().json('POST', '/api/admin/inventory', { items: [] })).status).toBe(401);
  });
});

describe('collections', () => {
  it('is a list of products you pick, and one switch puts it on the shop', async () => {
    const product = await createProduct({ title: 'Collected piece' });

    const made = await owner.json<AdminCollectionDTO>('POST', '/api/admin/collections', { title: 'Party pieces' });
    expect(made.status).toBe(201);
    expect(made.data).toMatchObject({ handle: 'party-pieces', published: true, productsCount: 0 });

    // on the shop's row of categories as soon as it is made
    const store = await new Shopper().json<StoreDTO>('GET', '/api/store');
    expect(store.data.menu.some((m) => m.collectionHandle === 'party-pieces')).toBe(true);

    // the pieces are chosen by hand
    expect((await owner.json('PUT', `/api/admin/collections/${made.data.id}/products`, { productIds: [product.id] })).status).toBe(204);
    const listed = await new Shopper().json<ProductListDTO>('GET', '/api/products?collection=party-pieces');
    expect(listed.data.items.map((p) => p.title)).toEqual(['Collected piece']);

    // switched off, it keeps its pieces but leaves the shop altogether
    const off = await owner.json<AdminCollectionDTO>('PATCH', `/api/admin/collections/${made.data.id}`, { published: false });
    expect(off.data.published).toBe(false);
    const quiet = await new Shopper().json<StoreDTO>('GET', '/api/store');
    expect(quiet.data.menu.some((m) => m.collectionHandle === 'party-pieces')).toBe(false);
    expect((await new Shopper().json('GET', '/api/collections/party-pieces')).status).toBe(404);
    await owner.json('PATCH', `/api/admin/collections/${made.data.id}`, { published: true });
    expect((await new Shopper().json('GET', '/api/collections/party-pieces')).status).toBe(200);

    // the row's order is set from the collections screen
    const order = (await new Shopper().json<StoreDTO>('GET', '/api/store')).data.menu.flatMap((m) => (m.collectionHandle ? [m.collectionHandle] : []));
    const moved = [order[order.length - 1]!, ...order.slice(0, -1)];
    expect((await owner.json('PUT', '/api/admin/collections/order', { handles: moved })).status).toBe(204);
    const after2 = await new Shopper().json<StoreDTO>('GET', '/api/store');
    expect(after2.data.menu.flatMap((m) => (m.collectionHandle ? [m.collectionHandle] : []))).toEqual(moved);
    // and deleting it takes it off the row for good
    expect((await owner.json('DELETE', `/api/admin/collections/${made.data.id}`)).status).toBe(204);
    const gone = await new Shopper().json<StoreDTO>('GET', '/api/store');
    expect(gone.data.menu.some((m) => m.collectionHandle === 'party-pieces')).toBe(false);
  });
});

describe('order emails', () => {
  /** The settings form always sends the lot, the chart as it stands included. */
  const settingsBody = async (orderNotificationEmail: string | null): Promise<SettingsInput> => {
    const now = await owner.json<SettingsDTO>('GET', '/api/admin/settings');
    return {
      name: 'Test Store',
      currency: 'USD',
      contactEmail: null,
      contactPhone: null,
      instagram: null,
      address: null,
      logoMediaId: null,
      featuredCollectionHandle: null,
      lookbookCollectionHandle: null,
      editorialCollectionHandle: null,
      lowStockThreshold: 3,
      checkoutHoldMinutes: 15,
      abandonedCartEmails: true,
      orderNotificationEmail,
      sizeChart: now.data.sizeChart,
      orderEmail: now.data.orderEmail,
    };
  };

  const mailTo = async (address: string) =>
    ((await listDevMail(env)) as { to: string; subject: string; html: string }[]).filter((m) => m.to === address);

  /** Place one order and run the alert the shop queues for it. */
  const placeAnOrder = async (tag: string) => {
    const product = await createProduct({ stock: [5, 5] });
    const shopper = new Shopper();
    const { checkout } = await readyCheckout(shopper, product.variants[0]!.id);
    const placed = await shopper.json<{ order: OrderDTO }>('POST', `/api/checkout/${checkout!.id}/complete`, { paymentMethod: 'cod' });
    expect(placed.status).toBe(200);
    await runJob(env, { type: 'email.new_order_alert', orderId: placed.data.order.id }, tag);
    return placed.data.order;
  };

  it('says nothing while no address is set', async () => {
    expect((await owner.json<SettingsDTO>('PUT', '/api/admin/settings', await settingsBody(null))).status).toBe(200);
    await placeAnOrder('alert-none');
    expect(await mailTo('orders@fdm.test')).toHaveLength(0);
  });

  it('emails the address the owner set, with the order in it', async () => {
    const saved = await owner.json<SettingsDTO>('PUT', '/api/admin/settings', await settingsBody('orders@fdm.test'));
    expect(saved.status).toBe(200);
    expect(saved.data.orderNotificationEmail).toBe('orders@fdm.test');

    const order = await placeAnOrder('alert-set');
    const [sent] = await mailTo('orders@fdm.test');
    expect(sent?.subject).toContain(`New order ${order.name}`);
    expect(sent?.html).toContain('/admin/orders/');
  });

  it('sends the buyer the words the owner wrote, with the order filled in', async () => {
    const body = await settingsBody('orders@fdm.test');
    const saved = await owner.json<SettingsDTO>('PUT', '/api/admin/settings', {
      ...body,
      orderEmail: {
        subject: 'Your pieces are ours to make — {{order}}',
        intro: 'Merci {{name}}. Order {{order}} for {{total}} is in the atelier.',
        signoff: 'Written by hand, in Beirut.',
      },
    });
    expect(saved.status).toBe(200);
    expect(saved.data.orderEmail.subject).toBe('Your pieces are ours to make — {{order}}');

    const order = await placeAnOrder('alert-copy');
    // the buyer's own letter, not the owner's alert
    await runJob(env, { type: 'email.order_confirmation', orderId: order.id }, 'confirm-copy');
    const [sent] = (await listDevMail(env) as { to: string; subject: string; html: string; text: string }[])
      .filter((m) => m.subject.startsWith('Your pieces are ours to make'));
    // the tokens are gone, the words are not
    expect(sent?.subject).toBe(`Your pieces are ours to make — ${order.name}`);
    expect(sent?.html).toContain('is in the atelier');
    expect(sent?.html).toContain('Written by hand, in Beirut.');
    expect(sent?.html).not.toContain('{{');
    expect(sent?.text).not.toContain('{{');

    // and what was bought is still printed by the shop, not by the owner
    expect(sent?.html).toContain('Total');
  });

  it('refuses a confirmation with no subject or no opening line', async () => {
    const body = await settingsBody(null);
    const res = await owner.json('PUT', '/api/admin/settings', {
      ...body,
      orderEmail: { subject: '', intro: '', signoff: null },
    });
    expect(res.status).toBe(422);
    expect(res.data.error.fields['orderEmail.subject']).toBeTruthy();
    expect(res.data.error.fields['orderEmail.intro']).toBeTruthy();
  });

  it('sends a test to the saved address, and refuses when there is none', async () => {
    expect((await owner.json('POST', '/api/admin/settings/order-email/test')).status).toBe(204);
    // the dev mailbox is keyed by what was sent, not when, so look for it
    const sent = await mailTo('orders@fdm.test');
    expect(sent.some((m) => m.subject.includes('Order emails are working'))).toBe(true);

    // not for anyone who wanders in
    expect((await new Shopper().json('POST', '/api/admin/settings/order-email/test')).status).toBe(401);

    // and nothing to send to once it is cleared
    expect((await owner.json<SettingsDTO>('PUT', '/api/admin/settings', await settingsBody(null))).status).toBe(200);
    const none = await owner.json('POST', '/api/admin/settings/order-email/test');
    expect(none.status).toBe(422);
    expect(none.data.error.fields.orderNotificationEmail).toBeTruthy();
  });
});

describe('size chart', () => {
  /** The settings form always sends the lot; only the chart changes here. */
  const settingsBody = (sizeChart: SettingsInput['sizeChart']): SettingsInput => ({
    name: 'Test Store',
    currency: 'USD',
    contactEmail: null,
    contactPhone: null,
    instagram: null,
    address: null,
    logoMediaId: null,
    featuredCollectionHandle: null,
    lookbookCollectionHandle: null,
    editorialCollectionHandle: null,
    lowStockThreshold: 3,
    checkoutHoldMinutes: 15,
    abandonedCartEmails: true,
    orderNotificationEmail: null,
    sizeChart,
    orderEmail: { subject: 'Order {{order}} confirmed', intro: 'We have it, {{name}}.', signoff: null },
  });

  it('starts as the sizes the store sells, with no numbers invented', async () => {
    const settings = await owner.json<SettingsDTO>('GET', '/api/admin/settings');
    expect(settings.data.sizeChart.columns).toEqual(['Bust', 'Waist', 'Hip', 'Length']);
    expect(settings.data.sizeChart.rows.map((r) => r.size)).toEqual(['Small', 'Medium', 'Large']);
    expect(settings.data.sizeChart.rows.flatMap((r) => r.values).every((v) => v === '')).toBe(true);
  });

  it('saves the owner\'s chart, and the storefront reads it', async () => {
    const chart = {
      heading: 'Fit & measurements',
      intro: 'Laid flat, in centimetres.',
      columns: ['Bust', 'Waist'],
      rows: [
        { size: 'Small', values: ['82', '64'] },
        { size: 'Medium', values: ['86', '68'] },
      ],
      note: 'Made in small runs — expect a centimetre either way.',
    };
    const saved = await owner.json<SettingsDTO>('PUT', '/api/admin/settings', settingsBody(chart));
    expect(saved.status).toBe(200);
    expect(saved.data.sizeChart).toEqual(chart);

    const store = await new Shopper().json<StoreDTO>('GET', '/api/store');
    expect(store.data.sizeChart).toEqual(chart);
  });

  it('refuses a size that does not line up with the measurements', async () => {
    const res = await owner.json('PUT', '/api/admin/settings', settingsBody({
      heading: 'Sizes',
      intro: null,
      columns: ['Bust'],
      rows: [{ size: 'Small', values: ['82', '64'] }],
      note: null,
    }));
    expect(res.status).toBe(422);
    expect(res.data.error.fields['sizeChart.rows.0.values']).toBeTruthy();
  });
});
