import React, { useMemo, useState } from 'react';
import { PRODUCTS, CATEGORIES, DROP } from '../data/products';
import { eyebrow } from '../data/sections';
import ProductCard from './ProductCard';
import Reveal from './Reveal';

/** The home grid is a taster, not the catalogue — see /components/Catalogue. */
const HOME_LIMIT = 10;

export default function Shop({ onOpen, onAll }) {
  const [active, setActive] = useState('All');

  const { shown, total } = useMemo(() => {
    const cat = CATEGORIES.find((c) => c.label === active);
    const list = !cat || !cat.lines ? PRODUCTS : PRODUCTS.filter((p) => cat.lines.includes(p.line));
    return { shown: list.slice(0, HOME_LIMIT), total: list.length };
  }, [active]);

  // the heading already says Échappée 4 à 7 — only badge cards when the row
  // actually holds both, otherwise every card carries the same sticker
  const mixed = useMemo(
    () => shown.some((p) => p.drop) && shown.some((p) => !p.drop),
    [shown],
  );

  return (
    <section className="section shell" id="boutique" style={{ paddingTop: 'clamp(60px, 9vh, 120px)' }}>
      <div className="sec-head">
        <div>
          <div className="label muted" style={{ marginBottom: 14 }}>{eyebrow('#boutique')}</div>
          <h2 className="display d-md">{DROP}</h2>
        </div>
        <div className="filters">
          {CATEGORIES.map((c) => (
            <button
              key={c.label}
              className={`chip ${active === c.label ? 'on' : ''}`}
              onClick={() => setActive(c.label)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid">
        {shown.map((p, i) => (
          <ProductCard key={p.id} product={p} index={i} onOpen={onOpen} showDrop={mixed} />
        ))}
      </div>

      <Reveal delay={150} className="more">
        <span className="label muted">
          Showing {shown.length} of {total}
          {active === 'All' ? ' pieces' : ` in ${active}`}
        </span>
        <button className="btn solid" onClick={() => onAll(active)} data-cursor="All">
          See all {PRODUCTS.length} pieces
        </button>
      </Reveal>
    </section>
  );
}
