import React, { useState } from 'react';
import Reveal from './Reveal';

/** Where sign-ups land until there is a real list behind this. */
const LIST = 'folliesdapresmidi@gmail.com';

export default function Newsletter() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [href, setHref] = useState('');

  /* There is no backend, so the sign-up opens a pre-addressed mail to the
     house rather than pretending to store the address. Swap this for a real
     list (Klaviyo, Mailchimp, a Shopify form action) when there is one — the
     markup stays as it is. */
  const submit = (e) => {
    e.preventDefault();
    const address = email.trim();
    if (!address.includes('@')) return;
    const subject = encodeURIComponent('Newsletter — add me to the list');
    const body = encodeURIComponent(
      `Please add this address to the Follies d'Après-Midi list:\n\n${address}\n`,
    );
    const url = `mailto:${LIST}?subject=${subject}&body=${body}`;
    setHref(url);
    setSent(true);
    // A mail client is not guaranteed to open — some browsers refuse the
    // navigation outright — so the link below stays as the way through.
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
              {sent ? 'Merci ✦' : 'Subscribe'}
            </button>
          </form>
          <p className="news-note label">
            {sent ? (
              <>
                Your mail app should be open — send it and you are on the list.{' '}
                <a className="link-u news-fallback" href={href}>Didn’t open? Tap here.</a>
              </>
            ) : (
              'Drops, pop-ups, and nothing else. Unsubscribe in one click.'
            )}
          </p>
        </Reveal>
      </div>
    </section>
  );
}
