import type { Email } from './templates';

/**
 * Brevo's transactional API.
 *
 * One header and a JSON body — no request signing, unlike SES. Its free tier
 * sends 300 a day, which is where this shop is, and the same key carries the
 * order confirmations and anything written to the list.
 *
 * Brevo will only send from an address it has been shown to own, so
 * EMAIL_FROM has to name a sender verified in the Brevo dashboard. It says
 * so plainly when it refuses, and that refusal is passed through to whoever
 * pressed the button rather than being swallowed.
 */

const ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

/** `Follies d'Après-Midi <orders@follies.com>` → the two parts Brevo wants. */
export function parseSender(from: string): { name?: string; email: string } {
  const m = /^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/.exec(from);
  if (!m) return { email: from.trim() };
  const name = m[1]!.replace(/^["']|["']$/g, '').trim();
  return name ? { name, email: m[2]!.trim() } : { email: m[2]!.trim() };
}

export interface BrevoResult {
  ok: boolean;
  status: number;
  /** Brevo's own code — 'invalid_parameter', 'unauthorized', … */
  code: string | null;
  detail: string;
}

export async function brevoSend(
  apiKey: string,
  from: string,
  to: string,
  email: Email,
  opts: { replyTo?: string | null; unsubscribeUrl?: string | null; tag?: string; attachment?: { url: string; name: string } | null } = {},
): Promise<BrevoResult> {
  const sender = parseSender(from);
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender,
      to: [{ email: to }],
      subject: email.subject,
      htmlContent: email.html,
      ...(email.text ? { textContent: email.text } : {}),
      ...(opts.replyTo ? { replyTo: { email: opts.replyTo } } : {}),
      ...(opts.tag ? { tags: [opts.tag] } : {}),
      /* Brevo fetches the file itself rather than being handed the bytes:
         a Worker has neither the memory nor the CPU to base64 a lookbook
         once per recipient. The URL has to be reachable from outside. */
      ...(opts.attachment ? { attachment: [{ url: opts.attachment.url, name: opts.attachment.name }] } : {}),
      // one click out, honoured by every serious mail client
      ...(opts.unsubscribeUrl
        ? {
            headers: {
              'List-Unsubscribe': `<${opts.unsubscribeUrl}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
          }
        : {}),
    }),
  });

  if (res.ok) return { ok: true, status: res.status, code: null, detail: '' };

  const text = (await res.text()).slice(0, 500);
  let code: string | null = null;
  let detail = text;
  try {
    const parsed = JSON.parse(text) as { code?: string; message?: string };
    code = parsed.code ?? null;
    detail = parsed.message || text;
  } catch {
    /* Brevo answered with something that is not JSON; the text is the detail */
  }
  return { ok: false, status: res.status, code, detail };
}

/** Worth trying again: their trouble, or ours going too fast. */
export const brevoRetryable = (r: BrevoResult): boolean => r.status >= 500 || r.status === 429;
