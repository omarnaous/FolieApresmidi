/**
 * Talking to the Worker.
 *
 * The site is also published to GitHub Pages, which has no API behind it.
 * There, /api/* returns the index.html the SPA fallback serves, so a caller
 * that assumed JSON would explode. Every helper here reports `offline`
 * instead, and the forms fall back to composing a mail — the order still
 * reaches the house, it just goes the slow way.
 */

const TIMEOUT = 12000;

async function post(path, payload) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctl.signal,
    });

    // GitHub Pages answers /api/* with the page itself — that is "no backend",
    // not "the order failed", and the caller needs to tell them apart.
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('application/json')) return { offline: true };

    const data = await res.json();
    if (res.ok && data.ok) return { ok: true, data };
    return { ok: false, error: data.error, fields: data.fields };
  } catch {
    // aborted, offline, DNS, blocked — all the same to the shopper
    return { offline: true };
  } finally {
    clearTimeout(timer);
  }
}

/** Only ids and quantities go up; the Worker prices the basket itself. */
export const placeOrder = ({ lines, payment, customer }) =>
  post('/api/order', {
    payment,
    ...customer,
    items: lines.map((l) => ({ id: l.id, qty: l.qty, size: l.size, colour: l.colour })),
  });

export const subscribe = (email) => post('/api/subscribe', { email });
