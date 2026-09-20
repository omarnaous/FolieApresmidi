import React, { useRef } from 'react';
import { imageSrc } from '../../shared/api';
import { useCart } from '../store/cart';
import { useMoney } from '../lib/queries';
import { optionSummary } from '../lib/catalog';
import { useEscape, useSheetFocus } from '../hooks/useSheet';

/** What the server says is wrong with a line, in the bag's own words. */
function problemFor(line, warnings) {
  const w = warnings.find((x) => x.lineId === line.id);
  if (w) return w.code === 'unavailable' || w.available <= 0 ? 'No longer available' : `Only ${w.available} left`;
  return line.available ? null : 'Sold out';
}

export default function CartDrawer({ open, onClose, onCheckout }) {
  const { cart, lines, count, subtotal, busy, qty, remove } = useCart();
  const money = useMoney();
  const drawer = useRef(null);

  useEscape(open, onClose);
  useSheetFocus(drawer, open);

  const warnings = cart?.warnings ?? [];

  return (
    // data-lenis-prevent so the bag still scrolls on touch: a stopped Lenis
    // preventDefaults every touchmove, nested scrollers included.
    <aside
      className={`drawer ${open ? 'on' : ''}`}
      aria-hidden={!open}
      aria-label="Shopping bag"
      aria-busy={busy}
      tabIndex={-1}
      ref={drawer}
      data-lenis-prevent
    >
      <div className="drawer-head">
        <span className="label">Your bag {count > 0 && `(${count})`}</span>
        <button className="label link-u" onClick={onClose}>Close</button>
      </div>

      <div className="drawer-body">
        {lines.length === 0 ? (
          <div className="empty">
            <span className="display d-sm" style={{ color: 'var(--ink)' }}>Nothing yet.</span>
            <span className="label">Produced in limited quantities.</span>
            <button className="btn" onClick={onClose}>Back to the boutique</button>
          </div>
        ) : (
          lines.map((l) => {
            const problem = problemFor(l, warnings);
            return (
              <div className="line" key={l.id}>
                <div className="plate packshot">
                  {l.image && <img
              decoding="async" src={imageSrc(l.image, 320)} alt={l.image.alt || l.productTitle} loading="lazy" />}
                </div>
                <div className="line-mid">
                  <span className="line-name">{l.productTitle}</span>
                  <span className="label muted">{optionSummary(l.options)}</span>
                  {problem && <span className="label bag-warn">{problem}</span>}
                  <span className="qty">
                    <button onClick={() => qty(l.id, -1)} aria-label="Decrease">−</button>
                    <span>{l.quantity}</span>
                    <button
                      onClick={() => qty(l.id, 1)}
                      aria-label="Increase"
                      disabled={l.maxQuantity !== null && l.quantity >= l.maxQuantity}
                    >
                      +
                    </button>
                  </span>
                </div>
                <div className="line-right">
                  <span className="card-price" style={{ fontSize: 15 }}>{money(l.lineTotal)}</span>
                  <button className="x" onClick={() => remove(l.id)}>Remove</button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {lines.length > 0 && (
        <div className="drawer-foot">
          <div className="total">
            <span className="label">Subtotal</span>
            <b>{money(subtotal)}</b>
          </div>
          {/* the code is asked for once, at the checkout, where the total it changes is */}
          <span className="label muted">Shipping and any code are taken at checkout.</span>
          <button className="btn solid block" data-cursor="Checkout" onClick={onCheckout}>Checkout</button>
        </div>
      )}
    </aside>
  );
}
