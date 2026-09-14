import React, { useEffect, useMemo, useState } from 'react';
import { useCart, money } from '../store/cart';

/** Swatch dots for the colour names the store actually uses. */
const DOT = {
  Brown: '#6b4a34', Green: '#7d8a6a', Blue: '#8fa3bd',
  Red: '#a52a1e', White: '#f4f1ea', Black: '#1a1a1a',
};

export default function QuickView({ product, onClose }) {
  const { add } = useCart();
  const [size, setSize] = useState(null);
  const [colour, setColour] = useState(null);
  const [shot, setShot] = useState(0);
  // hold the last product while the panel slides out
  const [cached, setCached] = useState(product);

  useEffect(() => {
    if (product) { setCached(product); return; }
    const t = setTimeout(() => setCached(null), 800);
    return () => clearTimeout(t);
  }, [product]);

  const p = cached;

  useEffect(() => {
    if (!p) return;
    setShot(0);
    setSize(p.sizes.length === 1 ? p.sizes[0] : null);
    setColour(p.colours.length === 1 ? p.colours[0] : null);
  }, [p]);

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

  if (!p) return <div className="qv" aria-hidden="true" />;

  const open = !!product;

  const needsColour = p.colours.length > 0;
  const ready = !!size && (!needsColour || !!colour);

  return (
    <div className={`qv ${open ? 'on' : ''}`} role="dialog" aria-label={p.name} aria-hidden={!open}>
      <button className="qv-close label" onClick={onClose} data-cursor="Close">Close</button>

      <div className="qv-media">
        {/* One strip for both layouts: the wide panel shows the selected
            shot, the phone shows every shot and you swipe. */}
        <div className="qv-strip">
          {p.images.map((src, i) => (
            <div
              key={src}
              className={`plate packshot qv-cell ${i === shot ? 'on' : ''}`}
              onClick={() => setShot((n) => (n + 1) % p.images.length)}
              data-cursor={p.images.length > 1 ? 'Next' : 'View'}
            >
              <img src={src} alt={`${p.name}${i ? ` — view ${i + 1}` : ''}`} />
            </div>
          ))}
        </div>

        {p.images.length > 1 && (
          <div className="qv-thumbs">
            {p.images.map((src, i) => (
              <button
                key={src}
                className={i === shot ? 'on' : ''}
                onClick={() => setShot(i)}
                aria-label={`Image ${i + 1}`}
              >
                <img src={src} alt="" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="qv-info">
        <div>
          <div className="label muted">{p.line}{p.drop ? ' · Échappée 4 à 7' : ''}</div>
          <h3 className="display d-sm" style={{ marginTop: 10 }}>{p.name}</h3>
          <div className="card-price" style={{ fontSize: 22, marginTop: 8 }}>{money(p.price)}</div>
        </div>

        {p.note && <p className="lede" style={{ fontSize: 15 }}>{p.note}</p>}

        {needsColour && (
          <div>
            <div className="label muted" style={{ marginBottom: 11 }}>
              Colour {colour && <span style={{ color: 'var(--ink)' }}>— {colour}</span>}
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

        <div>
          <div className="label muted" style={{ marginBottom: 11 }}>Size</div>
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
          className="btn solid block"
          disabled={!ready}
          style={{ opacity: ready ? 1 : 0.45 }}
          onClick={() => { add(p, size, colour); onClose(); }}
        >
          {ready ? `Add to bag — ${money(p.price)}` : needsColour && !colour ? 'Select a colour' : 'Select a size'}
        </button>

        <dl style={{ margin: 0 }}>
          <div className="spec"><dt>Category</dt><dd>{p.line}</dd></div>
          {p.colours.length > 0 && (
            <div className="spec"><dt>Colours</dt><dd>{p.colours.join(', ')}</dd></div>
          )}
          <div className="spec">
            <dt>Sizes</dt>
            <dd>{p.sizes.join(', ')}</dd>
          </div>
          <div className="spec">
            <dt>Exchanges</dt>
            <dd>
              Within 24 hours of receiving, for a defect or a wrong item or size. Unworn, unwashed,
              tags attached. No refunds — exchange only.
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
    </div>
  );
}
