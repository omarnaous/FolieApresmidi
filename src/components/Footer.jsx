import React from 'react';
import Reveal from './Reveal';

const COLS = [
  { t: 'Boutique', l: ['Échappée 4 à 7', 'Dresses', 'Co-ords', 'Tops', 'Bottoms'] },
  { t: 'Also', l: ['Jackets', 'Overalls', 'Bralettes', 'Jewellery'] },
];

export default function Footer() {
  return (
    <footer className="foot">
      <div className="shell">
        <div className="foot-cols">
          <div className="foot-col">
            <div className="label">Follies d'Après-Midi</div>
            <p className="lede" style={{ color: 'var(--bone-70)', fontSize: 15, maxWidth: '34ch' }}>
              Luxury prêt-à-porter, designed and produced in limited quantities in Lebanon.
              Épicée. Libre.
            </p>
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

          {COLS.map((c) => (
            <div className="foot-col" key={c.t}>
              <div className="label">{c.t}</div>
              {c.l.map((x) => (
                <a className="link-u" key={x} href="#boutique" style={{ fontSize: 14, color: 'var(--bone-70)' }}>{x}</a>
              ))}
            </div>
          ))}

          <div className="foot-col">
            <div className="label">Client care</div>
            <a
              className="link-u"
              href="mailto:folliesdapresmidi@gmail.com"
              style={{ fontSize: 14, color: 'var(--bone-70)' }}
              data-cursor="Email"
            >
              folliesdapresmidi@gmail.com
            </a>
            <a
              className="link-u"
              href="https://folliesdapresmidi.com/pages/exchange-policy"
              target="_blank"
              rel="noreferrer noopener"
              style={{ fontSize: 14, color: 'var(--bone-70)' }}
            >
              Exchange policy ↗
            </a>
            <span className="label muted" style={{ color: 'var(--bone-40)', lineHeight: 1.8 }}>
              Exchanges within 24 hours.<br />No refunds.
            </span>
          </div>
        </div>
      </div>

      <div className="shell">
        <Reveal variant="rv-mask" className="foot-word">FOLLIES</Reveal>
      </div>

      <div className="shell">
        <div className="foot-base label">
          <span>© {new Date().getFullYear()} Follies d'Après-Midi</span>
          <span>Beirut — 33.8938° N, 35.5018° E</span>
          <span>Built with React &amp; Remotion</span>
        </div>
      </div>
    </footer>
  );
}
