/**
 * The Meta (Facebook) pixel, for measuring and targeting Meta ads.
 *
 * Meta's snippet is loaded from here rather than pasted inline: the shop's
 * Content-Security-Policy runs only its own scripts, and allows the pixel's
 * one host (connect.facebook.net) and nothing else. The snippet's queue stub
 * is kept exactly, so events sent before fbevents.js arrives still go.
 *
 * The shop is one page that never reloads, so a PageView is sent on every
 * route change (main.jsx), not once. Commerce events carry the pieces — by
 * their handle, the one name every screen has for them — and the money, so
 * Meta can optimise ads for real purchases. Never loaded in the admin.
 */
import { decimalsFor } from '../../shared/money';

const PIXEL_ID = '1380099144201552';

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[];
  push: Fbq;
  loaded: boolean;
  version: string;
};

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

let started = false;

/** Meta's own loader, unchanged in what it does: a queue now, the library when it lands. */
function install() {
  if (window.fbq) return;
  const n = function (...args: unknown[]) {
    if (n.callMethod) n.callMethod(...args);
    else n.queue.push(args);
  } as Fbq;
  window.fbq = n;
  if (!window._fbq) window._fbq = n;
  n.push = n;
  n.loaded = true;
  n.version = '2.0';
  n.queue = [];
  const t = document.createElement('script');
  t.async = true;
  t.src = 'https://connect.facebook.net/en_US/fbevents.js';
  const s = document.getElementsByTagName('script')[0];
  s?.parentNode?.insertBefore(t, s);
}

const inAdmin = () => location.pathname.startsWith('/admin');

/** Start the pixel once, on the shop only. */
export function startPixel() {
  if (started || typeof window === 'undefined' || inAdmin()) return;
  started = true;
  install();
  window.fbq!('init', PIXEL_ID);
}

function send(event: string, params?: Record<string, unknown>) {
  if (!started || inAdmin() || !window.fbq) return;
  if (params) window.fbq('track', event, params);
  else window.fbq('track', event);
}

/** Money in minor units, as Meta wants it: a plain number in the currency's major unit. */
const major = (amount: number, currency: string) => amount / 10 ** decimalsFor(currency);

let lastPath = '';
/** A page was shown. Called on every route change; the same address twice is one view. */
export function pageView(path: string) {
  if (path === lastPath) return;
  lastPath = path;
  send('PageView');
}

/** A product page was opened. */
export function viewContent(p: { handle: string; title: string; price: number }, currency: string) {
  send('ViewContent', {
    content_ids: [p.handle],
    content_name: p.title,
    content_type: 'product',
    value: major(p.price, currency),
    currency,
  });
}

/** A piece went into the bag. */
export function addToCart(p: { handle: string; title: string }, price: number, currency: string) {
  send('AddToCart', {
    content_ids: [p.handle],
    content_name: p.title,
    content_type: 'product',
    value: major(price, currency),
    currency,
  });
}

/** The checkout opened on a bag. */
export function initiateCheckout(lines: { productHandle: string; quantity: number }[], total: number, currency: string) {
  send('InitiateCheckout', {
    content_ids: lines.map((l) => l.productHandle),
    content_type: 'product',
    num_items: lines.reduce((n, l) => n + l.quantity, 0),
    value: major(total, currency),
    currency,
  });
}

/**
 * An order was placed. Sent once per order on this device — the confirmation
 * page can be reopened from the order email, and that is not a second sale.
 */
export function purchase(order: {
  id: string;
  total: number;
  currency: string;
  lines: { productHandle: string | null; quantity: number }[];
}) {
  const key = `fdm-pixel-purchase:${order.id}`;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
  } catch {
    // storage refused (private mode): send it; a rare repeat beats a lost sale
  }
  send('Purchase', {
    content_ids: order.lines.flatMap((l) => (l.productHandle ? [l.productHandle] : [])),
    content_type: 'product',
    num_items: order.lines.reduce((n, l) => n + l.quantity, 0),
    value: major(order.total, order.currency),
    currency: order.currency,
  });
}
