import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PRODUCTS } from '../data/products';
import { useCart, money } from '../store/cart';
import { useSwipeDismiss } from '../hooks/useSwipeDismiss';

/** Swatch dots for the colour names the store actually uses. */
const DOT = {
  Brown: '#6b4a34', Green: '#7d8a6a', Blue: '#8fa3bd',
  Red: '#a52a1e', White: '#f4f1ea', Black: '#1a1a1a',
};

/** Four more pieces to look at — same category first, then anything else. */
function related(p) {
  if (!p) return [];
  const rest = PRODUCTS.filter((x) => x.id !== p.id);
  const same = rest.filter((x) => x.line === p.line);
  return [...same, ...rest.filter((x) => x.line !== p.line)].slice(0, 4);
}

export default function ProductPage({ product, onClose, onOpen }) {
  const { add } = useCart();
  const [size, setSize] = useState(null);
  const [colour, setColour] = useState(null);
  const [added, setAdded] = useState(false);
  const [nudge, setNudge] = useState(false);
  // hold the last product while the page slides out
  const [cached, setCached] = useState(product);
  const scroller = useRef(null);
  const picker = useRef(null);
  const gallery = useRef(null);
  const [shot, setShot] = useState(0);

  useEffect(() => {
    if (product) { setCached(product); return; }
    const t = setTimeout(() => setCached(null), 620);
    return () => clearTimeout(t);
  }, [product]);

  const p = cached;

  useEffect(() => {
    if (!p) return;
    setSize(p.sizes.length === 1 ? p.sizes[0] : null);
    setColour(p.colours.length === 1 ? p.colours[0] : null);
    setAdded(false);
    setShot(0);
    // a new piece always starts at the top, never mid-way down the last one
    scroller.current?.scrollTo({ top: 0, behavior: 'auto' });
    gallery.current?.scrollTo({ left: 0, behavior: 'auto' });
  }, [p]);

  /* On a phone the gallery is a swipeable row, so the dots follow the
     scroll rather than the other way round. Above 900px it is a stacked
     column and scrollLeft never moves, which leaves shot at 0 — harmless,
     since the dots are hidden there. */
  const onGalleryScroll = () => {
    const el = gallery.current;
    if (!el || !el.clientWidth) return;
    const pos = el.scrollLeft / el.clientWidth;
    setShot((n) => {
      const i = Math.round(pos);
      return n === i ? n : i;
    });
    /* Each shot drifts against the swipe and the one leaving dims, so the
       cells read as layered rather than as one sheet sliding. Written to a
       custom property per cell — the transform itself lives in the
       stylesheet, and the browser composites it. */
    for (const cell of el.children) {
      const d = cell.offsetLeft / el.clientWidth - pos; // -1 .. 0 .. 1
      cell.style.setProperty('--d', d.toFixed(3));
      cell.style.setProperty('--ad', Math.min(1, Math.abs(d)).toFixed(3));
    }
  };

  const goToShot = (i) => {
    const el = gallery.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  };

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const can = useMemo(() => {
    if (!p) return { size: () => false, colour: () => false };
    return {
      size: (s) => p.variants.some((v) => v.size === s && (!colour || v.colour === colour) && v.available),
      colour: (c) => p.variants.some((v) => v.colour === c && (!size || v.size === size) && v.available),
    };
  }, [p, size, colour]);

  const more = useMemo(() => related(p), [p]);

  // swipe down from the top to leave — the gallery keeps its own sideways swipes
  useSwipeDismiss(scroller, onClose, { enabled: !!product });

  // data-lenis-prevent: opening this stops Lenis, and a stopped Lenis
  // preventDefaults every touchmove — including the ones meant for this page.
  // The ref goes on the placeholder too. React reconciles it with the real
  // sheet below as the same div.pdp, so the node is stable from first render
  // — without it the swipe effect ran once against a null element (the first
  // render after a product is picked still has cached === null) and, with
  // nothing in its deps changing afterwards, never re-attached.
  if (!p) return <div className="pdp" aria-hidden="true" ref={scroller} data-lenis-prevent />;

  const open = !!product;
  const needsColour = p.colours.length > 0;
  const ready = !!size && (!needsColour || !!colour);
  const cta = ready
    ? `Add to bag — ${money(p.price)}`
    : needsColour && !colour ? 'Select a colour' : 'Select a size';

  /* A dead button tells you nothing. If a choice is still missing, take the
     shopper to it and flash it rather than refusing the tap. */
  const submit = () => {
    if (!ready) {
      picker.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setNudge(true);
      setTimeout(() => setNudge(false), 900);
      return;
    }
    add(p, size, colour);
    setAdded(true);
  };

  return (
    <div
      className={`pdp ${open ? 'on' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={p.name}
      aria-hidden={!open}
      ref={scroller}
      data-lenis-prevent
    >
      <header className="pdp-bar">
        <button className="pdp-back label" onClick={onClose}>
          <span aria-hidden="true">←</span> Boutique
        </button>
        <span className="pdp-mark">FDM</span>
        <button className="pdp-x label" onClick={onClose} aria-label="Close">Close</button>
      </header>

      <div className="pdp-body">
        {/* One markup for both: a stacked column on a wide screen, a
            swipeable snapping row on a phone. */}
        <div className="pdp-media">
          <div className="pdp-gallery" ref={gallery} onScroll={onGalleryScroll}>
            {p.images.map((src, i) => (
              <figure className="pdp-shot plate packshot" key={src}>
                <img
                  src={src}
                  alt={`${p.name}${i ? ` — view ${i + 1}` : ''}`}
                  loading={i === 0 ? 'eager' : 'lazy'}
                />
                {p.images.length > 1 && (
                  <figcaption className="pdp-num label">{String(i + 1).padStart(2, '0')}</figcaption>
                )}
              </figure>
            ))}
          </div>

          {p.images.length > 1 && (
            <div className="pdp-marks" role="tablist" aria-label="Views">
              {p.images.map((src, i) => (
                <button
                  key={src}
                  role="tab"
                  aria-selected={i === shot}
                  aria-label={`View ${i + 1}`}
                  className={`pdp-mark-n label ${i === shot ? 'on' : ''}`}
                  onClick={() => goToShot(i)}
                >
                  {String(i + 1).padStart(2, '0')}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Sticky on a wide screen, so the buy panel never scrolls away. */}
        <aside className="pdp-buy">
          <div className="pdp-buy-inner">
            <div className="label muted">{p.line}{p.drop ? ' · Échappée 4 à 7' : ''}</div>
            <h1 className="pdp-name display">{p.name}</h1>
            <div className="pdp-price">{money(p.price)}</div>

            {p.note && <p className="pdp-note">{p.note}</p>}

            {needsColour && (
              <div className="pdp-field">
                <div className="pdp-field-head">
                  <span className="label muted">Colour</span>
                </div>
                <div className="swatches">
                  {p.colours.map((c) => (
                    <button
                      key={c}
                      className={`swatch ${colour === c ? 'on' : ''}`}
                      disabled={!can.colour(c)}
                      onClick={() => setColour(c)}
                    >
                      <i style={{ background: DOT[c] || 'var(--sand)' }} />
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className={`pdp-field ${nudge ? 'nudge' : ''}`} ref={picker}>
              <div className="pdp-field-head">
                <span className="label muted">Size</span>
              </div>
              <div className="sizes">
                {p.sizes.map((s) => (
                  <button
                    key={s}
                    className={`size ${size === s ? 'on' : ''}`}
                    disabled={!can.size(s)}
                    onClick={() => setSize(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <button
              className={`btn solid block pdp-add ${ready ? '' : 'waiting'}`}
              onClick={submit}
            >
              {added ? 'Added to your bag ✓' : cta}
            </button>

            <dl className="pdp-specs">
              <div className="spec"><dt>Category</dt><dd>{p.line}</dd></div>
              {p.colours.length > 0 && (
                <div className="spec"><dt>Colours</dt><dd>{p.colours.join(', ')}</dd></div>
              )}
              <div className="spec"><dt>Sizes</dt><dd>{p.sizes.join(', ')}</dd></div>
              <div className="spec">
                <dt>Exchanges</dt>
                <dd>
                  Within 24 hours of receiving, for a defect or a wrong item or size. Unworn,
                  unwashed, tags attached. No refunds — exchange only.
                </dd>
              </div>
              <div className="spec">
                <dt>Store</dt>
                <dd>
                  <a className="link-u" href={p.url} target="_blank" rel="noreferrer noopener">
                    View on folliesdapresmidi.com ↗
                  </a>
                </dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>

      {more.length > 0 && (
        <section className="pdp-more">
          <div className="pdp-more-head">
            <span className="label muted">More from the boutique</span>
          </div>
          <div className="pdp-more-grid">
            {more.map((m) => (
              <button className="pdp-rel" key={m.id} onClick={() => onOpen(m)}>
                <span className="plate packshot pdp-rel-plate">
                  <img src={m.images[0]} alt={m.name} loading="lazy" />
                </span>
                <span className="pdp-rel-meta">
                  <span className="pdp-rel-name">{m.name}</span>
                  <span className="card-price">{money(m.price)}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Phone only: the price and the button stay in reach at any scroll depth. */}
      <div className="pdp-dock">
        <div className="pdp-dock-price">
          <span className="label muted">{[colour, size].filter(Boolean).join(' · ') || p.line}</span>
          <span className="card-price">{money(p.price)}</span>
        </div>
        <button className={`btn solid pdp-dock-add ${ready ? '' : 'waiting'}`} onClick={submit}>
          {added ? 'Added ✓' : 'Add to bag'}
        </button>
      </div>
    </div>
  );
}
