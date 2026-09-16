import React, { useState } from 'react';
import Reveal from './Reveal';
import { post } from '../lib/api';
import { apiFields, messageFor } from '../lib/errors';

export default function Newsletter() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

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
      await post('/api/subscribe', { email: address });
    } catch (err) {
      setSent(false);
      setEmail(address);
      setError(apiFields(err).email ?? messageFor(err, 'That did not go through. Try again.'));
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
          <p className={`news-note label ${error ? 'news-err' : ''}`} id="news-note" aria-live="polite">
            {error || (sent
              ? 'You are on the list. Watch for the next drop.'
              : 'Drops, pop-ups, and nothing else. Unsubscribe in one click.')}
          </p>
        </Reveal>
      </div>
    </section>
  );
}
