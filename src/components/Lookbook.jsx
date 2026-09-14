import React, { useRef } from 'react';
import Reveal from './Reveal';
import { LOOKS } from '../data/assets';
import { DROP } from '../data/products';
import { money } from '../store/cart';

export default function Lookbook({ onOpen }) {
  const rail = useRef(null);
  const drag = useRef({ down: false, x: 0, left: 0, moved: 0 });

  const down = (e) => {
    const el = rail.current;
    drag.current = { down: true, x: e.pageX, left: el.scrollLeft, moved: 0 };
    el.classList.add('drag');
  };
  const move = (e) => {
    if (!drag.current.down) return;
    const el = rail.current;
    const dx = e.pageX - drag.current.x;
    drag.current.moved = Math.abs(dx);
    el.scrollLeft = drag.current.left - dx;
  };
  const up = () => {
    drag.current.down = false;
    rail.current?.classList.remove('drag');
  };
  // a drag that travelled shouldn't also open the piece
  const maybeOpen = (p) => { if (drag.current.moved < 6) onOpen(p); };

  return (
    <section className="section" id="lookbook" style={{ paddingBottom: 'clamp(60px, 9vw, 120px)' }}>
      <div className="shell">
        <div className="sec-head">
          <div>
            <div className="label muted" style={{ marginBottom: 14 }}>03 — Lookbook</div>
            <h2 className="display d-md">{DROP}</h2>
          </div>
          <div className="label muted">Drag —&gt;</div>
        </div>
      </div>

      <div className="rail-wrap">
        <div
          className="rail"
          ref={rail}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerLeave={up}
        >
          {LOOKS.map((p, i) => (
            <Reveal key={p.id} className="rail-item" delay={i * 70}>
              <div
                className="plate packshot rv-img in"
                data-cursor="View"
                onClick={() => maybeOpen(p)}
              >
                <img src={p.images[0]} alt={p.name} loading="lazy" draggable="false" />
              </div>
              <div className="rail-cap">
                <span className="label">{p.name}</span>
                <span className="label muted">{money(p.price)}</span>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
