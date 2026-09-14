import React from 'react';
import Reveal from './Reveal';
import { POPUPS } from '../data/products';

export default function PopUps() {
  return (
    <section className="section shell" id="popups">
      <div className="sec-head">
        <div>
          <div className="label muted" style={{ marginBottom: 14 }}>04 — In person</div>
          <h2 className="display d-md">End of summer <i className="italic">pop-ups</i></h2>
        </div>
        <p className="label muted" style={{ maxWidth: 260, lineHeight: 1.9 }}>
          Clothes and drinks. No appointment, no list.
        </p>
      </div>

      <div className="pop">
        {POPUPS.map((p, i) => (
          <Reveal key={p.place} delay={i * 90}>
            <div className={`pop-row ${p.status}`} data-cursor={p.status === 'open' ? 'RSVP' : 'Archive'}>
              <span className="label">{String(i + 1).padStart(2, '0')}</span>
              <span className="pop-place">{p.place}</span>
              <span className="label">{p.city}</span>
              <span className="label">{p.dates}</span>
              <span className="label muted">
                <i className="pop-dot" />
                {p.time}
              </span>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
