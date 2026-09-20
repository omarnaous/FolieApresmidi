import type { AddressDTO, OrderDTO, OrderEmailDTO } from '../../shared/api';
import { formatMoney } from '../../shared/money';

export interface Email {
  subject: string;
  html: string;
  text: string;
}

export interface StoreBrand {
  name: string;
  url: string;
  contactEmail: string | null;
}

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const INK = '#0c0b0a';
const BONE = '#f2ede6';
const ASH = '#8a837b';
const TERRA = '#c4522c';
const SERIF = "'Instrument Serif','Times New Roman',Times,serif";
const SANS = "Inter,-apple-system,'Helvetica Neue',Arial,sans-serif";

function layout(store: StoreBrand, title: string, body: string, preheader: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:${BONE};color:${INK};font-family:${SANS};">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BONE}"><tr><td align="center" style="padding:44px 18px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="font-family:${SERIF};font-size:26px;letter-spacing:.02em;padding-bottom:34px"><a href="${escapeHtml(store.url)}" style="color:${INK};text-decoration:none">FDM</a></td></tr>
<tr><td style="font-family:${SERIF};font-size:36px;line-height:1.02;padding-bottom:20px">${escapeHtml(title)}</td></tr>
<tr><td style="font-size:15px;line-height:1.6">${body}</td></tr>
<tr><td style="padding-top:44px;font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:${ASH}">${escapeHtml(store.name)}${store.contactEmail ? ` · ${escapeHtml(store.contactEmail)}` : ''}</td></tr>
</table></td></tr></table></body></html>`;
}

const button = (href: string, label: string) =>
  `<p style="margin:28px 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:${INK};color:${BONE};padding:14px 26px;font-size:11px;letter-spacing:.22em;text-transform:uppercase;text-decoration:none">${escapeHtml(label)}</a></p>`;

const muted = (s: string) => `<span style="color:${ASH}">${s}</span>`;

const addressLines = (a: AddressDTO | null): string[] =>
  a ? [a.name, a.line1, a.line2, [a.city, a.region].filter(Boolean).join(', '), a.countryCode, a.phone].filter(Boolean) : [];

function orderTable(order: OrderDTO): string {
  const m = (n: number) => formatMoney(n, order.currency);
  const rows = order.lines
    .map(
      (l) => `<tr>
<td style="padding:10px 0;border-bottom:1px solid rgba(12,11,10,.14)">${escapeHtml(l.title)}<br>${muted(escapeHtml([l.variantTitle, `× ${l.quantity}`].filter(Boolean).join(' · ')))}</td>
<td align="right" style="padding:10px 0;border-bottom:1px solid rgba(12,11,10,.14);white-space:nowrap">${m(l.total)}</td></tr>`,
    )
    .join('');
  const p = order.pricing;
  const totals: [string, string][] = [['Subtotal', m(p.subtotal)]];
  for (const d of p.discounts) totals.push([`Discount (${escapeHtml(d.code)})`, `−${m(d.amount)}`]);
  if (p.shipping !== null) {
    const net = p.shipping - p.shippingDiscount;
    totals.push(['Delivery', net === 0 ? 'Free' : m(net)]);
  }
  for (const t of p.taxLines) totals.push([p.pricesIncludeTax ? `Includes ${escapeHtml(t.name)}` : escapeHtml(t.name), m(t.amount)]);
  const totalRows = totals
    .map(([k, v]) => `<tr><td style="padding:4px 0;color:${ASH}">${k}</td><td align="right" style="padding:4px 0">${v}</td></tr>`)
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0;font-size:14px">${rows}${totalRows}
<tr><td style="padding:12px 0;font-weight:600">Total</td><td align="right" style="padding:12px 0;font-weight:600">${m(p.total)}</td></tr></table>`;
}

/**
 * The owner's words, with the three things they can name filled in. Anything
 * they did not write is simply absent — a shop that leaves the sign-off empty
 * sends no sign-off rather than an empty paragraph.
 */
export function fillOrderTokens(text: string, order: OrderDTO): string {
  const first = order.shippingAddress?.name.split(' ')[0] ?? '';
  return text
    .replaceAll('{{order}}', order.name)
    .replaceAll('{{name}}', first || 'there')
    .replaceAll('{{total}}', formatMoney(order.pricing.total, order.currency));
}

export function orderConfirmation(store: StoreBrand, order: OrderDTO, statusUrl: string | null, copy: OrderEmailDTO): Email {
  const first = order.shippingAddress?.name.split(' ')[0] ?? '';
  const addr = addressLines(order.shippingAddress);
  const intro = fillOrderTokens(copy.intro, order);
  const signoff = copy.signoff ? fillOrderTokens(copy.signoff, order) : '';
  const body = `<p>${escapeHtml(intro)}</p>
${orderTable(order)}
${addr.length ? `<p style="margin:0 0 6px;font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:${ASH}">Delivering to</p><p style="margin:0">${addr.map(escapeHtml).join('<br>')}</p>` : ''}
${statusUrl ? button(statusUrl, 'View your order') : ''}${signoff ? `<p>${escapeHtml(signoff)}</p>` : ''}`;
  const text = [
    `Merci${first ? `, ${first}` : ''}.`,
    intro,
    '',
    ...order.lines.map((l) => `${l.quantity} × ${l.title}${l.variantTitle ? ` (${l.variantTitle})` : ''} — ${formatMoney(l.total, order.currency)}`),
    '',
    `Total: ${formatMoney(order.pricing.total, order.currency)}`,
    addr.length ? `\nDelivering to:\n${addr.join('\n')}` : '',
    statusUrl ? `\nView your order: ${statusUrl}` : '',
  ].join('\n');
  return {
    subject: fillOrderTokens(copy.subject, order),
    html: layout(store, `Merci${first ? `, ${first}` : ''}.`, body, `Order ${order.name} is confirmed`),
    text,
  };
}

export function orderStatusUpdate(
  store: StoreBrand,
  order: OrderDTO,
  status: 'shipped' | 'delivered' | 'cancelled' | 'refunded',
  statusUrl: string | null,
  refundAmount?: number,
): Email {
  const f = order.fulfillments.at(-1);
  const copy = {
    shipped: {
      subject: `Order ${order.name} is on its way`,
      title: 'On its way.',
      lead: `Your order ${escapeHtml(order.name)} has left the house.${
        f?.trackingNumber ? ` Tracking: ${escapeHtml([f.carrier, f.trackingNumber].filter(Boolean).join(' '))}.` : ''
      }`,
    },
    delivered: { subject: `Order ${order.name} was delivered`, title: 'Delivered.', lead: `Your order ${escapeHtml(order.name)} has been delivered. Wear it well.` },
    cancelled: { subject: `Order ${order.name} was cancelled`, title: 'Order cancelled.', lead: `Your order ${escapeHtml(order.name)} has been cancelled. If this is unexpected, reply to this email.` },
    refunded: {
      subject: `Refund for order ${order.name}`,
      title: 'Refund issued.',
      lead: `We have refunded ${formatMoney(refundAmount ?? order.pricing.refunded, order.currency)} for order ${escapeHtml(order.name)}.`,
    },
  }[status];
  const tracking = status === 'shipped' && f?.trackingUrl ? button(f.trackingUrl, 'Track the parcel') : '';
  const body = `<p>${copy.lead}</p>${tracking}${statusUrl ? button(statusUrl, 'View your order') : ''}`;
  const text = `${copy.title}\n\n${copy.lead.replace(/<[^>]+>/g, '')}\n${f?.trackingUrl && status === 'shipped' ? `\nTrack: ${f.trackingUrl}` : ''}${statusUrl ? `\nView your order: ${statusUrl}` : ''}`;
  return { subject: copy.subject, html: layout(store, copy.title, body, copy.subject), text };
}

export function newOrderAlert(store: StoreBrand, order: OrderDTO, adminUrl: string): Email {
  const body = `<p>${escapeHtml(order.name)} · ${escapeHtml(order.email)} · ${escapeHtml(order.paymentMethod.name)}</p>${orderTable(order)}${button(adminUrl, 'Open in admin')}`;
  return {
    subject: `New order ${order.name} — ${formatMoney(order.pricing.total, order.currency)}`,
    html: layout(store, `New order ${order.name}`, body, `${order.itemCount} items`),
    text: `New order ${order.name} from ${order.email}: ${formatMoney(order.pricing.total, order.currency)}\n${adminUrl}`,
  };
}

/**
 * What the Send a test button posts. It says nothing an order would say —
 * the point is only that mail reaches this address, and that whoever reads
 * it knows why it arrived.
 */
export function orderEmailTest(store: StoreBrand, adminUrl: string): Email {
  const body = `<p>This is where new orders will arrive. Every order placed at ${escapeHtml(store.name)} sends one of these the moment it is placed — what was bought, who it is for, and a way straight to it.</p>${button(adminUrl, 'Open the orders')}<p>${muted('Nothing was ordered. This was sent from your admin, to the address saved under Order emails.')}</p>`;
  return {
    subject: `Order emails are working — ${store.name}`,
    html: layout(store, 'Orders will arrive here.', body, 'A test from your admin'),
    text: `This is where new orders will arrive.\n\nEvery order placed at ${store.name} sends one of these.\n${adminUrl}\n\nNothing was ordered — this is a test from your admin.`,
  };
}

export function passwordReset(store: StoreBrand, name: string, url: string): Email {
  const body = `<p>Someone asked to reset the password for this account. If it was you, choose a new one below.</p>${button(url, 'Choose a new password')}<p>${muted('This link expires in one hour and works once. If you did not ask for it, you can ignore this email — your password stays the same.')}</p>`;
  return {
    subject: `Reset your password — ${store.name}`,
    html: layout(store, `Hello${name ? `, ${name.split(' ')[0]}` : ''}.`, body, 'Reset your password'),
    text: `Reset your password: ${url}\n\nThis link expires in one hour. If you did not ask for it, ignore this email.`,
  };
}

export function staffInvite(store: StoreBrand, name: string, inviter: string, url: string): Email {
  const body = `<p>${escapeHtml(inviter)} invited you to help run ${escapeHtml(store.name)}.</p>${button(url, 'Accept the invitation')}<p>${muted('This link expires in 7 days.')}</p>`;
  return { subject: `You are invited to the ${store.name} admin`, html: layout(store, `Hello, ${name.split(' ')[0]}.`, body, 'Admin invitation'), text: `${inviter} invited you to the ${store.name} admin: ${url}` };
}

export function abandonedCart(
  store: StoreBrand,
  lines: { title: string; variantTitle: string; quantity: number }[],
  url: string,
): Email {
  const list = lines.map((l) => `<li style="margin:4px 0">${escapeHtml(l.title)}${l.variantTitle ? muted(` — ${escapeHtml(l.variantTitle)}`) : ''} × ${l.quantity}</li>`).join('');
  const body = `<p>You left a few pieces in your bag. They are produced in limited quantities, so we cannot hold them for long.</p><ul style="padding-left:18px">${list}</ul>${button(url, 'Return to your bag')}`;
  return {
    subject: `Still thinking it over? — ${store.name}`,
    html: layout(store, 'Still yours, for now.', body, 'Your bag is waiting'),
    text: `You left these in your bag:\n${lines.map((l) => `- ${l.title}${l.variantTitle ? ` (${l.variantTitle})` : ''} × ${l.quantity}`).join('\n')}\n\nReturn to your bag: ${url}`,
  };
}

export { TERRA };

