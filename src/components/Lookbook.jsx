import React, { useRef } from 'react';
import Reveal from './Reveal';
import { imageSrc } from '../../shared/api';
import { eyebrow } from '../data/sections';
import { srcSet } from '../lib/catalog';
import { useCollection, useMoney, useProductList, useStore } from '../lib/queries';

export default function Lookbook({ onOpen }) {
  const rail = useRef(null);
  const drag = useRef({ down: false, x: 0, left: 0, moved: 0 });
  const money = useMoney();
  const { data: store } = useStore();
  const handle = store?.lookbookCollectionHandle;
  // six pieces of the lookbook collection, in the order the house set
  const { data } = useProductList(
    { collection: handle ?? undefined, sort: 'featured', limit: 6 },
    { enabled: !!handle },
  );
  const { data: featured } = useCollection(store?.featuredCollectionHandle);
  const looks = handle ? data?.items ?? [] : [];

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

  // nothing to show yet, or nothing in the collection: no empty section
  if (!looks.length) return null;

  return (
    <section className="section tight-top" id="lookbook" style={{ paddingBottom: 'clamp(60px, 9vw, 120px)' }}>
      <div className="shell">
        <div className="sec-head">
          <div>
            <div className="label muted" style={{ marginBottom: 14 }}>{eyebrow('#lookbook')}</div>
            <h2 className="display d-md">{featured?.title ?? store?.name}</h2>
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
          {looks.map((p, i) => (
            <Reveal key={p.id} className="rail-item" delay={i * 70}>
              <div
                className="plate packshot rv-img in"
                data-cursor="View"
                role="button"
                tabIndex={0}
                aria-label={p.title}
                onClick={() => maybeOpen(p)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(p); }
                }}
              >
                {p.images[0] && (
                  <img
                    src={imageSrc(p.images[0], 640)}
                    srcSet={srcSet(p.images[0])}
                    sizes="(max-width: 860px) 230px, 27vw"
                    alt={p.images[0].alt || p.title}
                    loading="lazy"
                    draggable="false"
                  />
                )}
              </div>
              <div className="rail-cap">
                <span className="label">{p.title}</span>
                <span className="label muted">{money(p.price)}</span>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
