import React, { useState } from 'react';
import Reveal from './Reveal';
import { FEED, post } from '../data/assets';

const ROWS = FEED.slice(0, 6);

/**
 * The house section, as an index rather than an essay: hover (or tap) a
 * line and the plate changes. Every frame links out to the post it came
 * from, so the section stays alive as the feed does.
 */
export default function Feed() {
  const [i, setI] = useState(0);
  const active = ROWS[i];

  return (
    <section className="section shell" id="maison">
      <div className="sec-head">
        <div>
          <div className="label muted" style={{ marginBottom: 14 }}>02 — The house</div>
          <h2 className="display d-md">The afternoon, <i className="italic">lately</i></h2>
        </div>
        <a
          className="label link-u"
          href="https://instagram.com/folliesdapresmidi"
          target="_blank"
          rel="noreferrer noopener"
          data-cursor="Instagram"
        >
          @folliesdapresmidi ↗
        </a>
      </div>

      <div className="feed">
        <Reveal variant="rv-mask" className="feed-stage rv-img">
          {ROWS.map((f, n) => (
            <a
              key={f.code}
              className={`feed-shot ${n === i ? 'on' : ''}`}
              href={post(f.code)}
              target="_blank"
              rel="noreferrer noopener"
              tabIndex={n === i ? 0 : -1}
              data-cursor="Open post"
              aria-hidden={n !== i}
            >
              <img src={f.src} alt={f.label} loading="lazy" />
            </a>
          ))}
          <span className="feed-stamp label">{active.date}</span>
        </Reveal>

        <ol className="feed-index">
          {ROWS.map((f, n) => (
            <li key={f.code}>
              <button
                className={`feed-row ${n === i ? 'on' : ''}`}
                onMouseEnter={() => setI(n)}
                onFocus={() => setI(n)}
                onClick={() => setI(n)}
                data-cursor="Look"
              >
                <span className="label feed-n">{String(n + 1).padStart(2, '0')}</span>
                <span className="feed-name">{f.label}</span>
                <span className="label muted feed-date">{f.date}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
