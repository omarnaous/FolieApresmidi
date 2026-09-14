import React from 'react';
import Reveal from './Reveal';
import { EDITO } from '../data/assets';
import { money } from '../store/cart';

export default function Editorial({ onOpen }) {
  const [hero, a, b] = EDITO;

  return (
    <section className="section shell" id="journal">
      <div className="edito">
        <Reveal
          variant="rv-mask"
          className="rv-img plate packshot"
          data-cursor="View"
          onClick={() => onOpen(hero)}
        >
          <img src={hero.images[0]} alt={hero.name} loading="lazy" />
        </Reveal>

        <div className="edito-txt">
          <Reveal><div className="label muted">02 — The house</div></Reveal>
          <Reveal delay={90}>
            <h2 className="display d-md">
              Limited quantities.<br />
              <i className="italic">Made in Lebanon.</i>
            </h2>
          </Reveal>
          <Reveal delay={160}>
            <p className="lede">
              Pieces for women who dress with confidence, attitude and instinct — who value
              exclusivity, comfort and craftsmanship, and clothes that feel alive. FDM is not only
              about what you wear, but the mood you step into.
            </p>
          </Reveal>
          <Reveal delay={230}>
            <div className="label muted">
              {hero.name} — {money(hero.price)} · {hero.line}
            </div>
          </Reveal>
          <Reveal delay={280}>
            <a className="btn" href="#popups" data-cursor="Visit">Where to find us</a>
          </Reveal>
        </div>
      </div>

      <div className="stack" style={{ paddingTop: 'clamp(50px, 8vw, 120px)' }}>
        {[a, b].filter(Boolean).map((p, i) => (
          <Reveal
            key={p.id}
            variant="rv-mask"
            delay={i * 180}
            className={`rv-img plate packshot ${i === 0 ? 'a' : 'b'}`}
            data-cursor="View"
            onClick={() => onOpen(p)}
          >
            <img src={p.images[0]} alt={p.name} loading="lazy" />
          </Reveal>
        ))}
      </div>
    </section>
  );
}
