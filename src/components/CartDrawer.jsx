import React, { useEffect } from 'react';
import { useCart, money } from '../store/cart';

export default function CartDrawer({ onCheckout }) {
  const { lines, count, subtotal, open, closeCart, qty, remove } = useCart();

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && closeCart();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [closeCart]);

  return (
    // data-lenis-prevent so the bag still scrolls on touch: a stopped Lenis
    // preventDefaults every touchmove, nested scrollers included.
    <aside
      className={`drawer ${open ? 'on' : ''}`}
      aria-hidden={!open}
      aria-label="Shopping bag"
      data-lenis-prevent
    >
      <div className="drawer-head">
        <span className="label">Your bag {count > 0 && `(${count})`}</span>
        <button className="label link-u" onClick={closeCart}>Close</button>
      </div>

      <div className="drawer-body">
        {lines.length === 0 ? (
          <div className="empty">
            <span className="display d-sm" style={{ color: 'var(--ink)' }}>Nothing yet.</span>
            <span className="label">Produced in limited quantities.</span>
            <button className="btn" onClick={closeCart}>Back to the boutique</button>
          </div>
        ) : (
          lines.map((l) => (
            <div className="line" key={l.key}>
              <div className="plate packshot"><img src={l.image} alt={l.name} /></div>
              <div className="line-mid">
                <span className="line-name">{l.name}</span>
                <span className="label muted">
                  {[l.colour, l.size === 'One size' ? 'One size' : `Size ${l.size}`].filter(Boolean).join(' · ')}
                </span>
                <span className="qty">
                  <button onClick={() => qty(l.key, -1)} aria-label="Decrease">−</button>
                  <span>{l.qty}</span>
                  <button onClick={() => qty(l.key, 1)} aria-label="Increase">+</button>
                </span>
              </div>
              <div className="line-right">
                <span className="card-price" style={{ fontSize: 15 }}>{money(l.price * l.qty)}</span>
                <button className="x" onClick={() => remove(l.key)}>Remove</button>
              </div>
            </div>
          ))
        )}
      </div>

      {lines.length > 0 && (
        <div className="drawer-foot">
          <div className="total">
            <span className="label">Subtotal</span>
            <b>{money(subtotal)}</b>
          </div>
          <span className="label muted">Shipping and duties calculated at checkout.</span>
          <button className="btn solid block" data-cursor="Checkout" onClick={onCheckout}>Checkout</button>
        </div>
      )}
    </aside>
  );
}
