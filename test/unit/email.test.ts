import { describe, expect, it } from 'vitest';
import { parseSender } from '../../worker/email/brevo';
import { newsletterLetter } from '../../worker/email/templates';

const store = { name: "Follies d'Après-Midi", url: 'https://shop.example', contactEmail: 'hello@shop.example' };
const OUT = 'https://shop.example/unsubscribe/abc123';

/**
 * The letter the house writes to its list. What matters is that the owner's
 * words arrive as they typed them, that nothing they type can become markup,
 * and that every copy carries its own way off the list.
 */
describe('a letter to the list', () => {
  it('sets each blank line as a new paragraph', () => {
    const letter = newsletterLetter(store, 'The afternoon collection', 'The new pieces are in.\n\nÉpicée. Libre.', OUT);
    expect(letter.html).toContain('<p style="margin:0 0 16px">The new pieces are in.</p>');
    expect(letter.html).toContain('Épicée. Libre.');
    expect(letter.subject).toBe('The afternoon collection');
  });

  it('keeps a single newline as a line break, not a paragraph', () => {
    const letter = newsletterLetter(store, 'Hello', 'Beit Misk\n04 — 06 September', OUT);
    expect(letter.html).toContain('Beit Misk<br>04 — 06 September');
  });

  it('cannot be made to carry markup', () => {
    const letter = newsletterLetter(store, 'Hello', '<script>alert(1)</script> & <b>bold</b>', OUT);
    expect(letter.html).not.toContain('<script>');
    expect(letter.html).not.toContain('<b>bold</b>');
    expect(letter.html).toContain('&lt;script&gt;');
    expect(letter.html).toContain('&amp;');
  });

  it('carries the way out, in both parts', () => {
    const letter = newsletterLetter(store, 'Hello', 'Words.', OUT);
    expect(letter.html).toContain(OUT);
    expect(letter.text).toContain(OUT);
  });
});

/** Brevo wants the sender split in two; EMAIL_FROM is written as one line. */
describe('the sender line', () => {
  it('splits a name from its address', () => {
    expect(parseSender("Follies d'Après-Midi <orders@follies.com>")).toEqual({
      name: "Follies d'Après-Midi",
      email: 'orders@follies.com',
    });
  });

  it('takes a bare address as it is', () => {
    expect(parseSender('orders@follies.com')).toEqual({ email: 'orders@follies.com' });
  });

  it('drops the quotes a name is sometimes written in', () => {
    expect(parseSender('"Follies" <orders@follies.com>')).toEqual({ name: 'Follies', email: 'orders@follies.com' });
  });
});
