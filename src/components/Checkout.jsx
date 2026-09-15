import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useCart, money } from '../store/cart';
import { useSwipeDismiss } from '../hooks/useSwipeDismiss';
import { placeOrder } from '../lib/api';

/** Where the order lands until there is an order system behind this. */
const HOUSE = 'folliesdapresmidi@gmail.com';

const PAYMENTS = [
  { id: 'whish', name: 'Whish Money', note: 'We send the number after you order.' },
  { id: 'cod', name: 'Cash on delivery', note: 'Pay the courier when it arrives.' },
];

/* Every field the courier needs, in the order you would say them out loud. */
const FIELDS = [
  { id: 'name', label: 'Full name', type: 'text', autoComplete: 'name', placeholder: 'Omar Naous' },
  { id: 'phone', label: 'Phone', type: 'tel', autoComplete: 'tel', placeholder: '+961 …' },
  { id: 'email', label: 'Email', type: 'email', autoComplete: 'email', placeholder: 'you@email.com' },
  { id: 'city', label: 'City', type: 'text', autoComplete: 'address-level2', placeholder: 'Beirut' },
  { id: 'area', label: 'Area / street', type: 'text', autoComplete: 'address-line1', placeholder: 'Mar Mikhaël, Armenia St.' },
  { id: 'building', label: 'Building, floor', type: 'text', autoComplete: 'address-line2', placeholder: 'Achkar bldg, 3rd floor' },
  { id: 'notes', label: 'Notes for the courier', type: 'text', optional: true, placeholder: 'Optional' },
];

const EMPTY = Object.fromEntries(FIELDS.map((f) => [f.id, '']));

/** Returns a map of field id -> what is wrong, empty when the form is good. */
function validate(values, payment) {
  const bad = {};
  for (const f of FIELDS) {
    if (f.optional) continue;
    if (!values[f.id].trim()) bad[f.id] = 'Required';
  }
  if (!bad.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
    bad.email = 'That does not look like an email';
  }
  // Lebanese numbers run 7–8 digits after the code; count digits, not format
  if (!bad.phone && values.phone.replace(/\D/g, '').length < 7) {
    bad.phone = 'That does not look like a phone number';
  }
  if (!payment) bad.payment = 'Choose how you want to pay';
  return bad;
}

export default function Checkout({ open, onClose }) {
  const { lines, count, subtotal, clear } = useCart();
  const [values, setValues] = useState(EMPTY);
  const [payment, setPayment] = useState('');
  const [bad, setBad] = useState({});
  const [done, setDone] = useState(null);
  const [sending, setSending] = useState(false);
  const sheet = useRef(null);

  useSwipeDismiss(sheet, onClose, { enabled: open });

  useEffect(() => {
    if (!open) return;
    sheet.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [open]);

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const set = (id, v) => {
    setValues((s) => ({ ...s, [id]: v }));
    // clear the complaint as soon as they start fixing it
    setBad((b) => (b[id] ? { ...b, [id]: undefined } : b));
  };

  const order = useMemo(() => {
    const items = lines
      .map((l) => `• ${l.qty} × ${l.name}${l.colour ? ` — ${l.colour}` : ''} / ${l.size} — ${money(l.price * l.qty)}`)
      .join('\n');
    return { items, total: money(subtotal) };
  }, [lines, subtotal]);

  const submit = async (e) => {
    e.preventDefault();
    const problems = validate(values, payment);
    setBad(problems);
    const first = Object.keys(problems)[0];
    if (first) {
      const el = document.getElementById(first === 'payment' ? 'co-payment' : `co-${first}`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus?.({ preventScroll: true });
      return;
    }

    const how = PAYMENTS.find((x) => x.id === payment)?.name ?? payment;
    const body = [
      'New order — Follies d\'Après-Midi', '',
      order.items, '',
      `Total: ${order.total}`,
      `Payment: ${how}`, '',
      `Name: ${values.name}`,
      `Phone: ${values.phone}`,
      `Email: ${values.email}`,
      `City: ${values.city}`,
      `Area: ${values.area}`,
      `Building: ${values.building}`,
      values.notes.trim() ? `Notes: ${values.notes}` : '',
    ].filter(Boolean).join('\n');

    const url = `mailto:${HOUSE}?subject=${encodeURIComponent(
      `Order — ${values.name} — ${order.total}`,
    )}&body=${encodeURIComponent(body)}`;

    setSending(true);
    const res = await placeOrder({ lines, payment, customer: values });
    setSending(false);

    if (res.ok) {
      setDone({ id: res.data.id, how, total: order.total, name: values.name });
      clear();
      return;
    }

    // The Worker rejected specific fields — show them where the form did not.
    if (res.fields) {
      setBad(res.fields);
      const k = Object.keys(res.fields)[0];
      document.getElementById(`co-${k}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }

    // No backend (GitHub Pages) or the network gave up: take the mail route
    // rather than losing the order.
    if (res.offline) {
      setDone({ href: url, how, total: order.total, name: values.name });
      clear();
      window.location.href = url;
      return;
    }

    setBad({ payment: res.error || 'We could not place that order. Try again.' });
  };

  const startOver = () => {
    setDone(null);
    setValues(EMPTY);
    setPayment('');
    setBad({});
    onClose();
  };

  return (
    <div
      className={`co ${open ? 'on' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Checkout"
      aria-hidden={!open}
      ref={sheet}
      data-lenis-prevent
    >
      <header className="co-bar">
        <button className="co-back label" onClick={onClose}>
          <span aria-hidden="true">←</span> Keep shopping
        </button>
        <span className="co-mark">FDM</span>
        <button className="co-x label" onClick={onClose} aria-label="Close">Close</button>
      </header>

      {done ? (
        <div className="co-done">
          <h1 className="display d-md">Merci, {done.name.split(' ')[0]}.</h1>
          {done.id ? (
            <>
              <p className="lede">
                We have it. Paying by {done.how}, {done.total} — we call to confirm
                before it ships.
              </p>
              <p className="label muted">Order {done.id}</p>
            </>
          ) : (
            <>
              <p className="lede">
                Your mail app should be open with the order in it — send it and we have it.
                Paying by {done.how}, {done.total}.
              </p>
              <a className="btn solid co-done-send" href={done.href}>Didn’t open? Send the order</a>
            </>
          )}
          <button className="btn" onClick={startOver}>Back to the boutique</button>
        </div>
      ) : lines.length === 0 ? (
        <div className="co-done">
          <h1 className="display d-md">Your bag is empty.</h1>
          <p className="lede">Nothing to check out yet.</p>
          <button className="btn solid" onClick={onClose}>Back to the boutique</button>
        </div>
      ) : (
        <form className="co-body" onSubmit={submit} noValidate>
          <div className="co-form">
            <div className="co-head">
              <div className="label muted">Checkout</div>
              <h1 className="display d-sm">Where is it going?</h1>
            </div>

            <div className="co-fields">
              {FIELDS.map((f) => (
                <label className={`co-field ${bad[f.id] ? 'bad' : ''} ${f.id === 'notes' ? 'wide' : ''}`} key={f.id}>
                  <span className="label muted">
                    {f.label}{f.optional ? '' : ' *'}
                  </span>
                  <input
                    id={`co-${f.id}`}
                    type={f.type}
                    value={values[f.id]}
                    autoComplete={f.autoComplete}
                    placeholder={f.placeholder}
                    onChange={(e) => set(f.id, e.target.value)}
                    aria-invalid={!!bad[f.id]}
                    aria-describedby={bad[f.id] ? `co-${f.id}-err` : undefined}
                  />
                  {bad[f.id] && (
                    <span className="co-err label" id={`co-${f.id}-err`}>{bad[f.id]}</span>
                  )}
                </label>
              ))}
            </div>

            <fieldset className={`co-pay ${bad.payment ? 'bad' : ''}`} id="co-payment" tabIndex={-1}>
              <legend className="label muted">Payment *</legend>
              {PAYMENTS.map((x) => (
                <label className={`co-opt ${payment === x.id ? 'on' : ''}`} key={x.id}>
                  <input
                    type="radio"
                    name="payment"
                    value={x.id}
                    checked={payment === x.id}
                    onChange={() => { setPayment(x.id); setBad((b) => ({ ...b, payment: undefined })); }}
                  />
                  <span className="co-opt-mark" aria-hidden="true" />
                  <span className="co-opt-txt">
                    <span className="co-opt-name">{x.name}</span>
                    <span className="label muted">{x.note}</span>
                  </span>
                </label>
              ))}
              {bad.payment && <span className="co-err label">{bad.payment}</span>}
            </fieldset>
          </div>

          {/* Sticky beside the form on a wide screen; the order stays in view. */}
          <aside className="co-summary">
            <div className="co-summary-in">
              <div className="label muted">Your bag ({count})</div>
              <ul className="co-lines">
                {lines.map((l) => (
                  <li className="co-line" key={l.key}>
                    <span className="plate packshot co-thumb">
                      <img src={l.image} alt={l.name} loading="lazy" />
                    </span>
                    <span className="co-line-mid">
                      <span className="co-line-name">{l.name}</span>
                      <span className="label muted">
                        {[l.colour, l.size].filter(Boolean).join(' · ')} · ×{l.qty}
                      </span>
                    </span>
                    <span className="card-price co-line-price">{money(l.price * l.qty)}</span>
                  </li>
                ))}
              </ul>
              <div className="total co-total">
                <span className="label">Total</span>
                <b>{money(subtotal)}</b>
              </div>
              <span className="label muted co-ship">
                Delivery in Lebanon. We confirm by phone before it ships.
              </span>
              <button type="submit" className="btn solid block" disabled={sending}>
                {sending ? 'Placing…' : 'Place the order'}
              </button>
            </div>
          </aside>
        </form>
      )}
    </div>
  );
}
