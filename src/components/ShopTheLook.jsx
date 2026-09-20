import React, { useEffect, useRef, useState } from 'react';
import { imageSrc } from '../../shared/api';
import { useCart } from '../store/cart';
import { useInView } from '../hooks/useInView';
import { isColourOption, isPlaceholderOption, resolveVariant, srcSet } from '../lib/catalog';
import { useMoney } from '../lib/queries';

const pad = (n) => String(n).padStart(2, '0');

/**
 * The foot of a product page: the pieces to wear with it. The owner pairs
 * them in the admin; with none paired the store suggests some, and the
 * heading says which it is. Keyed on the product by the parent, so each
 * piece deals in afresh.
 */
export default function ShopTheLook({ product, items, curated, onOpen }) {
  const [ref, seen] = useInView({ threshold: 0.12 });

  return (
    <section className="pdp-look" ref={ref} data-seen={seen || undefined} aria-labelledby="pdp-look-title">
      <div className="pdp-look-head">
        <div>
          <span className="label muted">Shop the look</span>
          <h2 className="display d-sm" id="pdp-look-title">
            {curated ? <>Worn with <i className="italic">{product.title}</i></> : 'Complete the look'}
          </h2>
        </div>
        <span className="label muted">
          {pad(items.length)} {items.length === 1 ? 'piece' : 'pieces'}
        </span>
      </div>
      <ol className="pdp-look-grid">
        {items.map((m, i) => (
          <LookPiece key={m.id} product={m} index={i} onOpen={onOpen} />
        ))}
      </ol>
    </section>
  );
}

/**
 * One piece. With nothing to choose it goes in the bag from here; with a
 * size or colour to pick, it opens its own page for that.
 */
function LookPiece({ product: m, index, onOpen }) {
  const { add } = useCart();
  const money = useMoney();
  const [state, setState] = useState('idle'); // idle · adding · added
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);

  // null while a size or colour is still to be picked
  const ready = resolveVariant(m, null);
  const choice = m.options.find((o) => !isPlaceholderOption(o) && o.values.length > 1);
  const choose = isColourOption(choice?.name ?? '') ? 'a colour' : `a ${(choice?.name ?? 'size').toLowerCase()}`;
  const img = m.images[0];
  const open = () => onOpen(m);

  const quickAdd = async () => {
    if (state !== 'idle') return;
    setState('adding');
    const ok = await add(m, ready.id);
    setState(ok ? 'added' : 'idle');
    if (ok) timer.current = setTimeout(() => setState('idle'), 2400);
  };

  return (
    <li className="look-piece" style={{ '--i': index }}>
      {/* the picture is a pointer shortcut; the name is the link for keyboards */}
      <div className="look-plate plate packshot" onClick={open} aria-hidden="true" data-cursor="View">
        {img && (
          <img
              decoding="async"
            src={imageSrc(img, 640)}
            srcSet={srcSet(img, [320, 640, 960])}
            sizes="(max-width: 900px) 50vw, 25vw"
            alt=""
            loading="lazy"
          />
        )}
        <span className="look-n label">{pad(index + 1)}</span>
        {!m.available && <span className="look-flag label">Sold out</span>}
      </div>

      <div className="look-meta">
        {m.productType && <span className="label muted">{m.productType}</span>}
        <button type="button" className="look-name" onClick={open}>{m.title}</button>
        <span className="card-price">{money(m.price)}</span>
      </div>

      {m.available && (ready ? (
        <button
          type="button"
          className={`look-act label ${state === 'added' ? 'done' : ''}`}
          onClick={quickAdd}
          aria-busy={state === 'adding'}
          aria-label={state === 'idle' ? `Add ${m.title} to your bag` : undefined}
        >
          {state === 'added' ? 'In your bag ✓' : state === 'adding' ? 'Adding…' : 'Add to bag +'}
        </button>
      ) : (
        <button type="button" className="look-act label" onClick={open} aria-label={`Choose ${choose} for ${m.title}`}>
          Choose {choose} <span aria-hidden="true">→</span>
        </button>
      ))}
    </li>
  );
}
