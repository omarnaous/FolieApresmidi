import React, { useState } from 'react';
import Reveal from './Reveal';
import { subscribe } from '../lib/api';

/** Where sign-ups land until there is a real list behind this. */
const LIST = 'folliesdapresmidi@gmail.com';

export default function Newsletter() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [href, setHref] = useState('');
  const [busy, setBusy] = useState(false);

  /* There is no backend, so the sign-up opens a pre-addressed mail to the
     house rather than pretending to store the address. Swap this for a real
     list (Klaviyo, Mailchimp, a Shopify form action) when there is one — the
     markup stays as it is. */
  const submit = async (e) => {
    e.preventDefault();
    const address = email.trim();
    if (!address.includes('@')) return;
    const subject = encodeURIComponent('Newsletter — add me to the list');
    const body = encodeURIComponent(
      `Please add this address to the Follies d'Après-Midi list:\n\n${address}\n`,
    );
    const url = `mailto:${LIST}?subject=${subject}&body=${body}`;

    setBusy(true);
    const res = await subscribe(address);
    setBusy(false);

    if (res.ok) { setHref(''); setSent(true); setEmail(''); return; }

    // No backend behind this copy of the site, or the network gave up: fall
    // back to the mail route rather than dropping the sign-up.
    setHref(url);
    setSent(true);
    setEmail('');
    window.location.href = url;
  };

  return (
    <section className="news section shell">
      <div className="news-in">
        <Reveal>
          <h2 className="display d-lg">
            <span className="rise"><span>Know before</span></span>
            <span className="rise"><span><i className="italic">everyone</i> else.</span></span>
          </h2>
        </Reveal>

        <Reveal delay={140}>
          <form className="field" onSubmit={submit}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email"
              aria-label="Email address"
              required
            />
            <button type="submit" className="label link-u" data-cursor="Send">
              {sent ? 'Merci ✦' : busy ? '…' : 'Subscribe'}
            </button>
          </form>
          <p className="news-note label">
            {sent ? (
              href ? (
                <>
                  Your mail app should be open — send it and you are on the list.{' '}
                  <a className="link-u news-fallback" href={href}>Didn’t open? Tap here.</a>
                </>
              ) : (
                'You are on the list. Watch for the next drop.'
              )
            ) : (
              'Drops, pop-ups, and nothing else. Unsubscribe in one click.'
            )}
          </p>
        </Reveal>
      </div>
    </section>
  );
}
