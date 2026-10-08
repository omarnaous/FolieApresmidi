import React from 'react';
import Reveal from './Reveal';
import { useEyebrow } from '../data/sections';
import { LOOKBOOK } from '../data/lookbook';

/**
 * The look book: the house's own photographs, on their own. No piece and no
 * price under them — the images carry the section. Each plate is graded the
 * way the rest of the site's photographs are, and uncovers on the scroll with
 * the same curtain the editorial plates use, a breath apart across a row.
 */
export default function Lookbook() {
  const eyebrow = useEyebrow('#lookbook');

  return (
    <section className="section shell tight-top" id="lookbook">
      <div className="sec-head">
        <div>
          <Reveal><div className="label muted">{eyebrow}</div></Reveal>
          <Reveal delay={90}>
            <h2 className="display d-md">The lookbook</h2>
          </Reveal>
        </div>
      </div>

      <div className="lb-grid">
        {LOOKBOOK.map((src, i) => (
          <Reveal
            key={src}
            variant="rv-mask"
            delay={(i % 3) * 120}
            className="rv-img plate lb-plate"
          >
            <img
              decoding="async"
              src={src}
              alt={`Follies d'Après-Midi — look ${i + 1}`}
              loading="lazy"
              draggable="false"
            />
          </Reveal>
        ))}
      </div>
    </section>
  );
}
