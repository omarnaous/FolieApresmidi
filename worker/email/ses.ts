import type { Email } from './templates';

/**
 * Amazon SES, signed by hand.
 *
 * SES has no API key to put in a header: every request is signed with AWS's
 * Signature Version 4, a chain of HMACs over a canonical form of the request.
 * That is the whole of the work here, and it is why this file exists rather
 * than a one-line fetch — but it buys a tenth of a cent per thousand emails
 * against twenty dollars a month, which for a shop this size is the whole
 * bill against nothing.
 *
 * Nothing is stored and nothing is cached: the signature is derived per
 * request, as AWS requires.
 */

const SERVICE = 'ses';
const ALGORITHM = 'AWS4-HMAC-SHA256';

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

const sha256 = async (data: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(data)));

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}

/** kSigning = HMAC(HMAC(HMAC(HMAC("AWS4"+secret, date), region), service), "aws4_request") */
async function signingKey(secret: string, date: string, region: string): Promise<ArrayBuffer> {
  let key: ArrayBuffer | Uint8Array = enc.encode(`AWS4${secret}`);
  for (const part of [date, region, SERVICE, 'aws4_request']) key = await hmac(key, part);
  return key as ArrayBuffer;
}

export interface SesCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

/** The credentials, if this environment has been given a set. */
export function sesFrom(env: Env): SesCredentials | null {
  const accessKeyId = env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return null;
  return { accessKeyId, secretAccessKey, region: env.AWS_REGION || 'us-east-1' };
}

export interface SesResult {
  ok: boolean;
  status: number;
  /** What SES called it — 'MessageRejected', 'Throttling', … */
  code: string | null;
  detail: string;
}

/**
 * Hand one email to SES. The caller decides what a refusal means: a 4xx that
 * is not throttling will not get better on a retry, and is reported rather
 * than thrown.
 */
export async function sesSend(
  creds: SesCredentials,
  from: string,
  to: string,
  email: Email,
  replyTo?: string | null,
): Promise<SesResult> {
  const host = `email.${creds.region}.amazonaws.com`;
  const path = '/v2/email/outbound-emails';
  const body = JSON.stringify({
    FromEmailAddress: from,
    Destination: { ToAddresses: [to] },
    ...(replyTo ? { ReplyToAddresses: [replyTo] } : {}),
    Content: {
      Simple: {
        Subject: { Data: email.subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: email.html, Charset: 'UTF-8' },
          ...(email.text ? { Text: { Data: email.text, Charset: 'UTF-8' } } : {}),
        },
      },
    },
  });

  // 20240521T093000Z, and the 20240521 the credential scope is dated by
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = stamp.slice(0, 8);
  const scope = `${date}/${creds.region}/${SERVICE}/aws4_request`;
  const payloadHash = await sha256(body);

  /* The canonical request: the same bytes AWS will rebuild on its side, so
     the two signatures agree. Header names lowercased and in order. */
  const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${stamp}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = ['POST', path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const stringToSign = [ALGORITHM, stamp, scope, await sha256(canonicalRequest)].join('\n');
  const signature = hex(await hmac(await signingKey(creds.secretAccessKey, date, creds.region), stringToSign));

  const res = await fetch(`https://${host}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host,
      'x-amz-date': stamp,
      'x-amz-content-sha256': payloadHash,
      authorization: `${ALGORITHM} Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body,
  });

  if (res.ok) return { ok: true, status: res.status, code: null, detail: '' };

  const text = (await res.text()).slice(0, 500);
  let code: string | null = res.headers.get('x-amzn-errortype');
  let detail = text;
  try {
    const parsed = JSON.parse(text) as { message?: string; Message?: string; __type?: string };
    detail = parsed.message || parsed.Message || text;
    code = code || parsed.__type || null;
  } catch {
    /* SES answered with something that is not JSON; the text is the detail */
  }
  // 'ThrottlingException:' and the like carry a trailing URL
  return { ok: false, status: res.status, code: code ? code.split(':')[0]! : null, detail };
}

/** Worth trying again: throttling, or anything AWS blames on itself. */
export const sesRetryable = (r: SesResult): boolean =>
  r.status >= 500 || r.status === 429 || r.code === 'ThrottlingException' || r.code === 'TooManyRequestsException';
