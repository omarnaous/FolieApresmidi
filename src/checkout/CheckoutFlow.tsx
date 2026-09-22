/**
 * Checkout, one sheet, three steps shown as you reach them: where it is
 * going, how it gets there, how it is paid for. A finished step folds into a
 * line with an Edit link; nothing ahead of you is shown until you get there.
 *
 * The checkout itself lives on the server (it holds the stock). Its id is kept
 * in sessionStorage so a refresh picks the same one back up, as long as the
 * bag still matches it.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { zEmail, type CartDTO, type CheckoutDTO, type CheckoutUpdateInput, type OrderDTO } from '../../shared/api';
import { formatMoney } from '../../shared/money';
import { ApiError, get, patch, post } from '../lib/api';
import { apiFields, focusFirstError, messageFor, stockLines, type FieldErrors } from '../lib/errors';
import { qk, useCartQuery, useStore } from '../lib/queries';
import {
  ADDRESS_ORDER,
  AddressFields,
  addressValues,
  checkAddress,
  defaultCountry,
  toAddress,
  type AddressField,
  type AddressValues,
} from '../ui/AddressFields';
import { CheckField, TextField } from '../ui/fields';
import { PricingRows, SummaryLines } from './Summary';

type Step = 'contact' | 'delivery' | 'payment';

const STORAGE_KEY = 'fdm.checkout';
const CONTACT_ORDER = ['email', 'phone', ...ADDRESS_ORDER.filter((f) => f !== 'phone')];
const fieldId = (field: string) => `co-${field}`;

const readId = () => {
  try { return sessionStorage.getItem(STORAGE_KEY); } catch { return null; }
};
const writeId = (id: string | null) => {
  try {
    if (id) sessionStorage.setItem(STORAGE_KEY, id);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* private mode: a refresh starts a fresh checkout */ }
};

const signature = (lines: { variantId: string; quantity: number }[]) =>
  lines.map((l) => `${l.variantId}:${l.quantity}`).sort().join(',');

/** Gone for good: start another rather than retrying this one. */
const isGone = (err: unknown) =>
  err instanceof ApiError && (err.status === 404 || err.code === 'NOT_FOUND' || err.code === 'CHECKOUT_EXPIRED');

/** The server's field paths ("shippingAddress.city") onto this form's fields. */
const fieldFor = (path: string): string | null => {
  if (path.startsWith('shippingAddress.')) return path.slice('shippingAddress.'.length);
  return path === 'email' || path === 'phone' ? path : null;
};

const without = (errors: FieldErrors, field: string): FieldErrors => {
  if (!errors[field]) return errors;
  const rest = { ...errors };
  delete rest[field];
  return rest;
};

function stepFor(co: CheckoutDTO): Step {
  if (!co.email || !co.shippingAddress) return 'contact';
  if (co.requiresShipping && !co.shippingRateId) return 'delivery';
  return 'payment';
}

/**
 * Resume the stored checkout when it still describes the bag; otherwise open
 * a new one. The one it replaces is handed back so what was typed survives.
 */
async function openCheckout(cart: CartDTO | undefined) {
  let previous: CheckoutDTO | null = null;
  const id = readId();
  if (id) {
    try {
      const co = await get<CheckoutDTO>(`/api/checkout/${encodeURIComponent(id)}`);
      if (co.status === 'completed' && co.orderToken) return { checkout: co, previous };
      if (co.status === 'open' && (!cart || signature(co.lines) === signature(cart.lines))) return { checkout: co, previous };
      previous = co;
    } catch (err) {
      if (!isGone(err)) throw err;
    }
    writeId(null);
  }
  if (cart && cart.lines.length === 0) return { checkout: null, previous };
  const co = await post<CheckoutDTO>('/api/checkout');
  writeId(co.id);
  return { checkout: co, previous };
}

interface Contact {
  email: string;
  phone: string;
  acceptsMarketing: boolean;
}

interface Problem {
  key: string;
  title: string;
  message: string;
}

function StepDone({ id, title, summary, onEdit }: { id: string; title: string; summary: string[]; onEdit: () => void }) {
  return (
    <div className="co-step-done">
      <div className="co-step-done-txt">
        <h2 className="label muted" id={id}>{title}</h2>
        <p className="co-step-sum">
          {summary.filter(Boolean).map((line) => <span key={line}>{line}</span>)}
        </p>
      </div>
      <button type="button" className="label link-u" onClick={onEdit} aria-label={`Edit — ${title}`}>Edit</button>
    </div>
  );
}

export default function CheckoutFlow({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const { data: store } = useStore();
  const cart = useCartQuery();
  const cartReady = cart.isSuccess || cart.isError;

  const [attempt, setAttempt] = useState(0);
  const [boot, setBoot] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [bootError, setBootError] = useState('');
  const [co, setCo] = useState<CheckoutDTO | null>(null);
  const [step, setStep] = useState<Step>('contact');
  /* Folded on a phone, always open on a desktop — the stylesheet decides
     which, this only remembers whether it has been asked to open. */
  const [sumOpen, setSumOpen] = useState(false);
  const [contact, setContact] = useState<Contact>({ email: '', phone: '', acceptsMarketing: false });
  const [address, setAddress] = useState<AddressValues>(() => addressValues(null, store ? defaultCountry(store) : ''));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [payment, setPayment] = useState('');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [saving, setSaving] = useState<null | 'contact' | 'rate' | 'code' | 'place'>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stock, setStock] = useState<Problem[]>([]);
  // one request per attempt, even when StrictMode runs the effect twice
  const booting = useRef<{ attempt: number; run: ReturnType<typeof openCheckout> } | null>(null);

  const format = useCallback(
    (amount: number) => formatMoney(amount, co?.pricing.currency ?? store?.currency ?? 'USD'),
    [co?.pricing.currency, store?.currency],
  );

  const seed = useCallback((next: CheckoutDTO, previous: CheckoutDTO | null) => {
    const from = next.email || next.shippingAddress || !previous ? next : previous;
    setContact({
      email: from.email ?? '',
      phone: from.phone ?? from.shippingAddress?.phone ?? '',
      acceptsMarketing: from.acceptsMarketing,
    });
    setAddress(addressValues(from.shippingAddress, store ? defaultCountry(store) : ''));
    setPayment(next.paymentMethods.length === 1 ? next.paymentMethods[0]?.id ?? '' : '');
    setStep(stepFor(next));
  }, [store]);

  useEffect(() => {
    if (!cartReady) return undefined;
    if (booting.current?.attempt !== attempt) booting.current = { attempt, run: openCheckout(cart.data) };
    let live = true;
    booting.current.run.then(
      ({ checkout, previous }) => {
        if (!live) return;
        if (!checkout) { setBoot('empty'); return; }
        if (checkout.status === 'completed' && checkout.orderToken) {
          writeId(null);
          void client.invalidateQueries({ queryKey: qk.cart });
          navigate(`/orders/${encodeURIComponent(checkout.orderToken)}`, { replace: true });
          return;
        }
        setCo(checkout);
        seed(checkout, previous);
        setBoot('ready');
      },
      (err: unknown) => {
        if (!live) return;
        if (cart.data?.lines.length === 0) { setBoot('empty'); return; }
        setBootError(messageFor(err, 'The checkout did not open. Try again.'));
        setBoot('error');
      },
    );
    return () => { live = false; };
    // keyed on the attempt alone: the bag is read once per attempt, and a
    // later refetch of it must not restart the checkout
  }, [cartReady, attempt]);

  /* The store says where it ships, and it can land after the form does — so a
     country nobody has chosen takes the store's own the moment one is known.
     Watched rather than set once: opening the checkout seeds the address after
     this runs, and a seed with no country of its own would leave the field
     showing the only country on offer while the form held nothing — Continue
     then refused an address that looked perfectly filled in. */
  useEffect(() => {
    if (!store) return;
    setAddress((a) => (a.countryCode ? a : { ...a, countryCode: defaultCountry(store) }));
  }, [store, address.countryCode]);

  const titleFor = (variantId: string) => co?.lines.find((l) => l.variantId === variantId)?.productTitle ?? 'A piece';

  const contactBody = (): CheckoutUpdateInput => ({
    email: contact.email.trim(),
    phone: contact.phone.trim(),
    acceptsMarketing: contact.acceptsMarketing,
    shippingAddress: toAddress({ ...address, phone: contact.phone }),
  });

  /**
   * PATCH the checkout. If its hold has run out, open a fresh one from the bag
   * and send it everything already given, plus this change.
   */
  const update = async (body: CheckoutUpdateInput): Promise<CheckoutDTO> => {
    if (!co) throw new Error('No checkout is open.');
    try {
      return await patch<CheckoutDTO>(`/api/checkout/${encodeURIComponent(co.id)}`, body);
    } catch (err) {
      if (!isGone(err)) throw err;
      const fresh = await post<CheckoutDTO>('/api/checkout');
      writeId(fresh.id);
      setNotice('The checkout timed out, so we opened it again. Check the details below.');
      const known = co.shippingAddress ? contactBody() : {};
      return patch<CheckoutDTO>(`/api/checkout/${encodeURIComponent(fresh.id)}`, { ...known, ...body });
    }
  };

  const fail = (err: unknown) => {
    const fields = apiFields(err, fieldFor);
    if (Object.keys(fields).length) {
      setErrors(fields);
      setStep('contact');
      // a frame later, once the contact step has rendered its inputs
      requestAnimationFrame(() => focusFirstError(fields, CONTACT_ORDER, fieldId));
      return;
    }
    const lines = stockLines(err);
    if (lines.length) {
      setStock(lines.map((l) => ({
        key: l.variantId,
        title: titleFor(l.variantId),
        message: l.available > 0 ? `Only ${l.available} left` : 'Sold out',
      })));
      requestAnimationFrame(() => document.getElementById('co-problems')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      return;
    }
    setNotice(messageFor(err, 'That did not go through. Try again.'));
  };

  const setAddressField = (field: AddressField, value: string) => {
    setAddress((a) => ({ ...a, [field]: value }));
    // clear the complaint as soon as they start fixing it
    setErrors((e) => without(e, field));
  };

  const saveContact = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const found = checkAddress({ ...address, phone: contact.phone });
    if (!contact.email.trim()) found.email = 'Required';
    else if (!zEmail.safeParse(contact.email).success) found.email = 'That does not look like an email';
    if (!contact.phone.trim()) found.phone = 'Required';
    if (Object.keys(found).length) {
      setErrors(found);
      focusFirstError(found, CONTACT_ORDER, fieldId);
      return;
    }
    setSaving('contact');
    setNotice(null);
    try {
      const next = await update(contactBody());
      setCo(next);
      setErrors({});
      setStep(next.requiresShipping ? 'delivery' : 'payment');
    } catch (err) {
      fail(err);
    } finally {
      setSaving(null);
    }
  };

  const pickRate = async (id: string) => {
    if (!co || saving || co.shippingRateId === id) return;
    const before = co;
    setCo({ ...co, shippingRateId: id });
    setSaving('rate');
    setNotice(null);
    try {
      setCo(await update({ shippingRateId: id }));
    } catch (err) {
      setCo(before);
      fail(err);
    } finally {
      setSaving(null);
    }
  };

  const applyCode = async (e: FormEvent) => {
    e.preventDefault();
    const value = code.trim();
    if (!value || saving) return;
    setSaving('code');
    setCodeError(null);
    try {
      const next = await update({ discountCode: value });
      setCo(next);
      if (next.discountError) setCodeError(next.discountError);
      else setCode('');
    } catch (err) {
      setCodeError(messageFor(err, 'That code did not apply.'));
    } finally {
      setSaving(null);
    }
  };

  const removeCode = async () => {
    if (saving) return;
    setSaving('code');
    setCodeError(null);
    try {
      setCo(await update({ discountCode: null }));
    } catch (err) {
      setCodeError(messageFor(err));
    } finally {
      setSaving(null);
    }
  };

  const place = async () => {
    if (!co || saving) return;
    if (!payment) {
      const found = { ...errors, payment: 'Choose how you want to pay' };
      setErrors(found);
      focusFirstError(found, ['payment'], fieldId);
      return;
    }
    setSaving('place');
    setNotice(null);
    setStock([]);
    try {
      const done = await post<{ orderToken: string; order: OrderDTO }>(
        `/api/checkout/${encodeURIComponent(co.id)}/complete`,
        { paymentMethod: payment },
      );
      writeId(null);
      client.setQueryData(qk.order(done.orderToken), done.order);
      void client.invalidateQueries({ queryKey: qk.cart });
      navigate(`/orders/${encodeURIComponent(done.orderToken)}`, { replace: true });
    } catch (err) {
      if (isGone(err)) {
        // the hold ran out between steps: reopen with everything given, then they place it again
        try {
          const next = await update({ ...contactBody(), shippingRateId: co.shippingRateId });
          setCo(next);
          setStep(stepFor(next));
        } catch (again) {
          fail(again);
        }
      } else {
        fail(err);
      }
    } finally {
      setSaving(null);
    }
  };

  if (boot === 'loading') {
    return (
      <div className="co-done" aria-busy="true">
        <span className="label muted" role="status">Opening the checkout…</span>
      </div>
    );
  }

  if (boot === 'empty') {
    return (
      <div className="co-done">
        <h1 className="display d-md">Your bag is empty.</h1>
        <p className="lede">Nothing to check out yet.</p>
        <button className="btn solid" onClick={onClose}>Back to the boutique</button>
      </div>
    );
  }

  if (boot === 'error' || !co) {
    return (
      <div className="co-done" role="alert">
        <h1 className="display d-md">The checkout did not open.</h1>
        <p className="lede">{bootError}</p>
        <button className="btn solid" onClick={() => { setBoot('loading'); setAttempt((n) => n + 1); }}>Try again</button>
        <button className="btn" onClick={onClose}>Back to the boutique</button>
      </div>
    );
  }

  const steps: Step[] = co.requiresShipping ? ['contact', 'delivery', 'payment'] : ['contact', 'payment'];
  const at = steps.indexOf(step);
  const rate = co.shippingRates.find((r) => r.id === co.shippingRateId);
  const shipTo = co.shippingAddress;
  const country = store?.shipsTo.find((c) => c.code === shipTo?.countryCode)?.name ?? shipTo?.countryCode ?? '';
  const count = co.lines.reduce((n, l) => n + l.quantity, 0);
  const problems: Problem[] = [
    ...co.problems.map((p) => ({ key: p.variantId, title: titleFor(p.variantId), message: p.message })),
    ...stock.filter((s) => !co.problems.some((p) => p.variantId === s.key)),
  ];

  const STEP_NAMES: Record<Step, string> = { contact: 'Details', delivery: 'Delivery', payment: 'Payment' };

  return (
    <div className="co-body">
      <div className="co-form">
        {/* Where you are, and how much is left. A checkout that does not say
            is a checkout people leave. */}
        <ol className="co-rail" aria-label="Checkout steps">
          {steps.map((s, i) => (
            <li key={s} className={`co-rail-step${i === at ? ' on' : ''}${i < at ? ' done' : ''}`} aria-current={i === at ? 'step' : undefined}>
              <span className="co-rail-n">{String(i + 1).padStart(2, '0')}</span>
              <span className="co-rail-name">{STEP_NAMES[s]}</span>
            </li>
          ))}
        </ol>

        <div aria-live="polite">
          {notice && <p className="co-alert">{notice}</p>}
        </div>

        {problems.length > 0 && (
          <div className="co-alert" role="alert" id="co-problems">
            <span className="label">Not everything in your bag is still available</span>
            <ul>
              {problems.map((p) => <li key={p.key}>{p.title} — {p.message}</li>)}
            </ul>
            <button type="button" className="label link-u" onClick={() => navigate('/cart', { replace: true })}>
              Back to the bag
            </button>
          </div>
        )}

        <section className="co-step">
          {step === 'contact' ? (
            <form onSubmit={saveContact} noValidate aria-labelledby="co-step-contact">
              <div className="co-head">
                <div className="label muted">Checkout</div>
                <h1 className="display d-sm" id="co-step-contact">Where is it going?</h1>
              </div>

              <div className="co-fields">
                <TextField
                  id={fieldId('email')}
                  label="Email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@email.com"
                  value={contact.email}
                  error={errors.email}
                  onChange={(e) => { setContact((c) => ({ ...c, email: e.target.value })); setErrors((x) => without(x, 'email')); }}
                />
                <TextField
                  id={fieldId('phone')}
                  label="Phone"
                  type="tel"
                  autoComplete="tel"
                  placeholder="+961 …"
                  value={contact.phone}
                  error={errors.phone}
                  onChange={(e) => { setContact((c) => ({ ...c, phone: e.target.value })); setErrors((x) => without(x, 'phone')); }}
                />
                <CheckField
                  id={fieldId('marketing')}
                  label="Tell me about drops and pop-ups"
                  wide
                  checked={contact.acceptsMarketing}
                  onChange={(acceptsMarketing) => setContact((c) => ({ ...c, acceptsMarketing }))}
                />
              </div>

              <AddressFields
                idPrefix="co"
                values={address}
                errors={errors}
                onChange={setAddressField}
                countries={store?.shipsTo ?? []}
              />

              <div className="co-actions">
                <button type="submit" className="btn solid" disabled={saving === 'contact'}>
                  {saving === 'contact' ? 'Saving…' : 'Continue'}
                </button>
              </div>
            </form>
          ) : (
            <StepDone
              id="co-step-contact"
              title="Where it is going"
              summary={[
                [co.email, co.phone].filter(Boolean).join(' · '),
                shipTo ? [shipTo.name, shipTo.line1, shipTo.line2, shipTo.city, country].filter(Boolean).join(', ') : '',
              ]}
              onEdit={() => setStep('contact')}
            />
          )}
        </section>

        {co.requiresShipping && (
          <section className={`co-step${at < 1 ? ' is-ahead' : ''}`} aria-labelledby="co-step-delivery">
            {at < 1 ? (
              <h2 className="display d-sm co-step-title" id="co-step-delivery">Delivery</h2>
            ) : step === 'delivery' ? (
              <>
                <h2 className="display d-sm co-step-title" id="co-step-delivery">Delivery</h2>
                {co.shippingRates.length === 0 ? (
                  <div className="co-note">
                    <p className="lede">We do not deliver to {country || 'that address'} yet.</p>
                    <button type="button" className="label link-u" onClick={() => setStep('contact')}>Change the address</button>
                  </div>
                ) : (
                  <>
                    <fieldset className="co-pay" aria-busy={saving === 'rate'}>
                      <legend className="label muted">Choose a delivery *</legend>
                      {co.shippingRates.map((r) => (
                        <label className={`co-opt ${co.shippingRateId === r.id ? 'on' : ''}`} key={r.id}>
                          <input
                            type="radio"
                            name="co-rate"
                            value={r.id}
                            checked={co.shippingRateId === r.id}
                            onChange={() => pickRate(r.id)}
                          />
                          <span className="co-opt-mark" aria-hidden="true" />
                          <span className="co-opt-txt">
                            <span className="co-opt-name">{r.name}</span>
                            {r.deliveryEstimate && <span className="label muted">{r.deliveryEstimate}</span>}
                          </span>
                          <span className="card-price co-opt-price">{r.amount === 0 ? 'Free' : format(r.amount)}</span>
                        </label>
                      ))}
                    </fieldset>
                    <div className="co-actions">
                      <button
                        type="button"
                        className="btn solid"
                        disabled={!co.shippingRateId || saving === 'rate'}
                        onClick={() => setStep('payment')}
                      >
                        Continue
                      </button>
                    </div>
                  </>
                )}
              </>
            ) : at > 1 ? (
              <StepDone
                id="co-step-delivery"
                title="Delivery"
                summary={[rate ? [rate.name, rate.deliveryEstimate, rate.amount === 0 ? 'Free' : format(rate.amount)].filter(Boolean).join(' · ') : '']}
                onEdit={() => setStep('delivery')}
              />
            ) : null}
          </section>
        )}

        {/* All three stand on the page from the first moment, one under the
            other, so what the checkout asks for is known before it is asked.
            The ones not yet reached are shut: their name, and nothing to
            fill in. */}
        <section className={`co-step${at < steps.length - 1 ? ' is-ahead' : ''}`} aria-labelledby="co-step-payment">
          <h2 className="display d-sm co-step-title" id="co-step-payment">Payment</h2>
          {at === steps.length - 1 && (<>
            {co.paymentMethods.length === 0 ? (
              <p className="lede">There is no way to pay online yet. Write to us and we will take the order by hand.</p>
            ) : (
              <fieldset className={`co-pay ${errors.payment ? 'bad' : ''}`} id={fieldId('payment')} tabIndex={-1}>
                <legend className="label muted">Payment *</legend>
                {co.paymentMethods.map((x) => (
                  <label className={`co-opt ${payment === x.id ? 'on' : ''}`} key={x.id}>
                    <input
                      type="radio"
                      name="payment"
                      value={x.id}
                      checked={payment === x.id}
                      onChange={() => { setPayment(x.id); setErrors((e) => without(e, 'payment')); }}
                    />
                    <span className="co-opt-mark" aria-hidden="true" />
                    <span className="co-opt-txt">
                      <span className="co-opt-name">{x.name}</span>
                      {x.description && <span className="label muted">{x.description}</span>}
                    </span>
                  </label>
                ))}
                {errors.payment && <span className="co-err label">{errors.payment}</span>}
              </fieldset>
            )}
            <div className="co-actions">
              <button
                type="button"
                className="btn solid block"
                onClick={place}
                disabled={saving !== null || problems.length > 0 || co.paymentMethods.length === 0}
                aria-busy={saving === 'place'}
              >
                {saving === 'place' ? 'Placing…' : `Place the order — ${format(co.pricing.total)}`}
              </button>
            </div>
          </>)}
        </section>
      </div>

      {/* Sticky beside the form on a wide screen, where there is room for it.
          On a phone it is folded to one line — the way every house's checkout
          does it — so the form starts at the top of the screen instead of
          behind a screenful of card. */}
      <aside className={`co-summary${sumOpen ? ' is-open' : ''}`}>
        <button
          type="button"
          className="co-summary-toggle"
          aria-expanded={sumOpen}
          aria-controls="co-summary-in"
          onClick={() => setSumOpen((v) => !v)}
        >
          <span className="label">
            {sumOpen ? 'Hide' : 'Show'} order summary
            <i className="co-summary-caret" aria-hidden="true" />
          </span>
          <span className="co-summary-total">{format(co.pricing.total)}</span>
        </button>
        <div className="co-summary-in" id="co-summary-in">
          <div className="co-summary-head">
            <span className="label">Your bag</span>
            <span className="label muted">{count} {count === 1 ? 'piece' : 'pieces'}</span>
          </div>
          <SummaryLines
            lines={co.lines.map((l) => ({
              key: l.variantId,
              title: l.productTitle,
              variantTitle: l.variantTitle,
              quantity: l.quantity,
              total: l.lineTotal,
              image: l.image,
            }))}
            format={format}
          />

          <div className="co-summary-part">
          {co.discountCode ? (
            <div className="bag-code-on">
              <span className="label">Code {co.discountCode}</span>
              <button type="button" className="x" onClick={removeCode} disabled={saving === 'code'}>Remove</button>
            </div>
          ) : (
            <form className="bag-code" onSubmit={applyCode}>
              <label className="sr-only" htmlFor="co-code">Discount code</label>
              <input
                id="co-code"
                value={code}
                onChange={(e) => { setCode(e.target.value); setCodeError(null); }}
                placeholder="Discount code"
                autoComplete="off"
                autoCapitalize="characters"
                aria-invalid={!!codeError}
              />
              <button type="submit" className="label link-u" disabled={!code.trim() || saving === 'code'}>
                {saving === 'code' ? '…' : 'Apply'}
              </button>
            </form>
          )}
          {(codeError || co.discountError) && (
            <span className="co-err label" role="alert">{codeError || co.discountError}</span>
          )}
          </div>

          <div className="co-summary-part">
            <PricingRows pricing={co.pricing} format={format} />
          </div>
          <span className="label muted co-ship">Delivery in Lebanon.</span>
        </div>
      </aside>
    </div>
  );
}
