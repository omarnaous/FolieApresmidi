import React from 'react';
import Reveal from './Reveal';
import { useEyebrow } from '../data/sections';
import { emphasis } from '../lib/emphasis';
import { useStore } from '../lib/queries';

export default function PopUps() {
  const eyebrow = useEyebrow('#popups');
  const copy = useStore().data?.home?.popups;
  const rows = copy?.rows ?? [];

  return (
    <section className="section shell" id="popups">
      <div className="sec-head">
        <div>
          <div className="label muted" style={{ marginBottom: 14 }}>{eyebrow}</div>
          <h2 className="display d-md">{copy ? emphasis(copy.heading) : '\u00a0'}</h2>
        </div>
        {copy?.intro && (
          <p className="label muted" style={{ maxWidth: 260, lineHeight: 1.9 }}>{copy.intro}</p>
        )}
      </div>

      <div className="pop">
        {rows.map((p, i) => (
          <Reveal key={`${p.place}-${i}`} delay={i * 90}>
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
