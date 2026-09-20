import React, { useState } from 'react';
import Reveal from './Reveal';
import { post } from '../lib/api';
import { apiFields, messageFor } from '../lib/errors';
import { useStore } from '../lib/queries';

/**
 * The list is gathered here and written to nowhere: no email goes out for
 * joining it. So what joining is worth is handed over on the spot — the
 * server answers with the code the owner set, and it is printed here to be
 * copied and carried to the checkout.
 */
export default function Newsletter() {
  // what joining is worth, e.g. "15% off your first order" — the phrase only;
  // the code itself is handed over on subscribing
  const offer = useStore().data?.newsletterOffer ?? null;
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  /** what the server gave back for joining: { code, offer } */
  const [reward, setReward] = useState(null);
  const [copied, setCopied] = useState(false);

  /* Optimistic: the thanks shows the moment the address goes, and only a
     refusal from the server takes it back — with the address put back in
     the field so it can be fixed rather than retyped. */
  const submit = async (e) => {
    e.preventDefault();
    const address = email.trim();
    if (!address.includes('@')) {
      setError('That does not look like an email.');
      return;
    }
    setError('');
    setSent(true);
    setEmail('');
    try {
      setReward(await post('/api/subscribe', { email: address }));
    } catch (err) {
      setSent(false);
      setEmail(address);
      setError(apiFields(err).email ?? messageFor(err, 'That did not go through. Try again.'));
    }
  };

  /* Copied where the clipboard allows it; where it does not, the code is on
     the page in full and can be read straight off it. */
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reward.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="news section shell">
      <div className="news-in">
        <Reveal>
          <h2 className="display d-lg">
            <span className="rise"><span>Know before</span></span>
            <span className="rise"><span><i className="italic">everyone</i> else.</span></span>
          </h2>
          {offer && !sent && (
            <p className="news-offer">
              <b>{offer}</b> when you join the list — the code appears the moment you do.
            </p>
          )}
        </Reveal>

        <Reveal delay={140}>
          <form className="field" onSubmit={submit} noValidate>
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); if (error) setError(''); }}
              placeholder="your@email"
              aria-label="Email address"
              aria-invalid={!!error}
              aria-describedby="news-note"
              autoComplete="email"
              required
            />
            <button type="submit" className="label link-u" data-cursor="Send">
              {sent ? 'Merci ✦' : 'Subscribe'}
            </button>
          </form>
          {sent && reward?.code && (
            <div className="news-code" role="status">
              <span className="label news-code-top">{reward.offer ? `${reward.offer}, with` : 'Your code'}</span>
              <button type="button" className="news-code-v" onClick={copy} data-cursor={copied ? 'Copied' : 'Copy'}>
                {reward.code}
              </button>
              <span className="label news-code-note">{copied ? 'Copied ✦' : 'Tap to copy — enter it at checkout.'}</span>
            </div>
          )}
          <p className={`news-note label ${error ? 'news-err' : ''}`} id="news-note" aria-live="polite">
            {error || (sent ? 'You are on the list. Watch for the next drop.' : 'Drops, pop-ups, and nothing else. Unsubscribe in one click.')}
          </p>
        </Reveal>
      </div>
    </section>
  );
}
