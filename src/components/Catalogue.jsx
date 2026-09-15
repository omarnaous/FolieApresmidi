import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PRODUCTS, CATEGORIES } from '../data/products';
import ProductCard from './ProductCard';
import { money } from '../store/cart';

const SORTS = [
  { key: 'featured', label: 'Featured' },
  { key: 'low', label: 'Price ↑' },
  { key: 'high', label: 'Price ↓' },
  { key: 'az', label: 'A–Z' },
];

/** Cheap fuzzy-ish match: every typed word must appear somewhere in the
 *  piece — its name, category, colours, sizes or the store's own copy. */
const haystack = (p) =>
  `${p.name} ${p.line} ${p.colours.join(' ')} ${p.sizes.join(' ')} ${p.note}`.toLowerCase();

export default function Catalogue({ open, onClose, onOpen, initialCategory = 'All' }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(initialCategory);
  const [sort, setSort] = useState('featured');
  const input = useRef(null);

  useEffect(() => { if (open) setActive(initialCategory); }, [open, initialCategory]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => input.current?.focus(), 700);
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => { clearTimeout(t); window.removeEventListener('keydown', esc); };
  }, [open, onClose]);

  const results = useMemo(() => {
    const cat = CATEGORIES.find((c) => c.label === active);
    let list = !cat || !cat.lines ? PRODUCTS : PRODUCTS.filter((p) => cat.lines.includes(p.line));

    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length) {
      list = list.filter((p) => {
        const hay = haystack(p);
        return words.every((w) => hay.includes(w));
      });
    }

    const sorted = [...list];
    if (sort === 'low') sorted.sort((a, b) => a.price - b.price);
    if (sort === 'high') sorted.sort((a, b) => b.price - a.price);
    if (sort === 'az') sorted.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return sorted;
  }, [q, active, sort]);

  // a badge on every card marks nothing — see ProductCard
  const mixed = useMemo(
    () => results.some((p) => p.drop) && results.some((p) => !p.drop),
    [results],
  );

  const range = results.length
    ? `${money(Math.min(...results.map((p) => p.price)))} – ${money(Math.max(...results.map((p) => p.price)))}`
    : null;

  return (
    // data-lenis-prevent so the results list and the chip rows still scroll on
    // touch: a stopped Lenis preventDefaults every touchmove it sees.
    <div className={`cat ${open ? 'on' : ''}`} aria-hidden={!open} data-lenis-prevent>
      <div className="cat-bar shell">
        <div className="cat-bar-top">
          <div>
            <div className="label muted">Catalogue</div>
            <h2 className="display d-sm" style={{ marginTop: 6 }}>All pieces</h2>
          </div>
          <button className="label link-u" onClick={onClose} data-cursor="Close">Close</button>
        </div>

        <div className="search">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M11 11l4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <input
            ref={input}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search — a name, a colour, a size, a fabric…"
            aria-label="Search the catalogue"
          />
          {q && <button className="label link-u" onClick={() => setQ('')}>Clear</button>}
        </div>

        <div className="cat-controls">
          <div className="filters left">
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
          <div className="filters right">
            {SORTS.map((s) => (
              <button
                key={s.key}
                className={`chip ${sort === s.key ? 'on' : ''}`}
                onClick={() => setSort(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="cat-count label muted">
          {results.length} {results.length === 1 ? 'piece' : 'pieces'}
          {range ? ` · ${range}` : ''}
          {q ? ` · “${q}”` : ''}
        </div>
      </div>

      <div className="cat-body shell">
        {results.length === 0 ? (
          <div className="cat-empty">
            <span className="display d-sm">Nothing under that name.</span>
            <span className="label muted">Try a colour, a category, or clear the search.</span>
            <button className="btn" onClick={() => { setQ(''); setActive('All'); }}>Reset</button>
          </div>
        ) : (
          <div className="grid">
            {results.map((p, i) => (
              <ProductCard key={p.id} product={p} index={i} onOpen={onOpen} showDrop={mixed} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
