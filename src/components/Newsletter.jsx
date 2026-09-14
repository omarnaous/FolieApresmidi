import React, { useState } from 'react';
import Reveal from './Reveal';

export default function Newsletter() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const submit = (e) => {
    e.preventDefault();
    if (!email.includes('@')) return;
    // Wire this to your list (Klaviyo, Mailchimp, a Shopify form action…)
    setSent(true);
    setEmail('');
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
            {sent
              ? 'You are on the list. Watch for the next drop.'
              : 'Drops, pop-ups, and nothing else. Unsubscribe in one click.'}
          </p>
        </Reveal>
      </div>
    </section>
  );
}
