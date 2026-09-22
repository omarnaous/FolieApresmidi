import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { imageSrc } from '../../shared/api';
import { useCart } from '../store/cart';
import ShopTheLook from './ShopTheLook';
import SizeChart, { hasSizeChart } from './SizeChart';
import { useSwipeDismiss } from '../hooks/useSwipeDismiss';
import { useEscape, useLinger, useSheetFocus } from '../hooks/useSheet';
import { featuredIn, isColourOption, isPlaceholderOption, isSizeOption, resolveVariant, srcSet } from '../lib/catalog';
import { isNotFound } from '../lib/errors';
import { useAvailability, useLook, useMoney, useProduct, useStore } from '../lib/queries';

/** "Size" → "Sizes", for the spec list. */
const plural = (name) => (/s$/i.test(name) ? name : `${name}s`);

/* A wide screen reads the piece as a pinned stack of plates; a phone swipes
   a row, and so does anyone who has asked for less motion. */
const STACKED = '(min-width: 901px) and (prefers-reduced-motion: no-preference)';
const stacked = () => typeof window !== 'undefined' && window.matchMedia(STACKED).matches;

export default function ProductPage({ handle, onClose, onOpen }) {
  const { add, notify } = useCart();
  const money = useMoney();
  const { data: store } = useStore();
  // hold the last product while the page slides out
  const cached = useLinger(handle, 620);
  const open = !!handle;
  const product = useProduct(cached);
  const p = product.data;
  const { data: live } = useAvailability(cached, open);
  const { data: look } = useLook(cached);

  // option index → chosen value
  const [picks, setPicks] = useState({});
  const [added, setAdded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [nudge, setNudge] = useState(false);
  const [chart, setChart] = useState(false);
  const scroller = useRef(null);
  const fields = useRef([]);
  const gallery = useRef(null);
  const media = useRef(null);
  const stage = useRef(null);
  const frame = useRef(0);
  const [shot, setShot] = useState(0);

  useEffect(() => {
    if (!p) return;
    // an option with a single value is already chosen
    setPicks(Object.fromEntries(
      p.options.flatMap((o, i) => (o.values.length === 1 ? [[i, o.values[0].value]] : [])),
    ));
    setAdded(false);
    setShot(0);
    setChart(false);
    // a new piece always starts at the top, never mid-way down the last one
    scroller.current?.scrollTo({ top: 0, behavior: 'auto' });
    gallery.current?.scrollTo({ left: 0, behavior: 'auto' });
    // keyed on the piece, not the object: a refetch of the same piece keeps the picks
  }, [p?.id]);

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

  /* ── The stack, on a wide screen ────────────────────────────
     The gallery pins to the screen and the scroll deals the next plate up
     over the last. The column of full-height photos it replaces ran three
     screens deep and every one of them had to be scrolled past to reach the
     rest of the page; this is one screen, and each turn of the wheel shows
     something. All the handler writes is a number per shot — how many steps
     away it stands — and the stylesheet does the moving, so the browser
     composites it and nothing is laid out twice. */
  const measure = () => {
    const box = media.current;
    const pin = stage.current;
    const cells = gallery.current?.children;
    if (!box || !pin || !cells?.length || !stacked()) return;
    // how far the pinned plate has ridden up the column it is pinned inside
    const travel = box.offsetHeight - pin.offsetHeight;
    const passed = pin.getBoundingClientRect().top - box.getBoundingClientRect().top;
    const through = travel > 0 ? Math.min(1, Math.max(0, passed / travel)) : 0;
    const pos = through * (cells.length - 1);
    box.style.setProperty('--f', through.toFixed(4));
    box.style.setProperty('--p', pos.toFixed(3));
    for (let i = 0; i < cells.length; i += 1) cells[i].style.setProperty('--t', (i - pos).toFixed(3));
    const at = Math.round(pos);
    setShot((n) => (n === at ? n : at));
  };

  const onSheetScroll = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      measure();
    });
  };

  // before the paint, so a piece is never shown mid-deal for a frame
  useLayoutEffect(() => {
    measure();
    const again = () => measure();
    window.addEventListener('resize', again);
    return () => {
      window.removeEventListener('resize', again);
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [p?.id, open]);

  const goToShot = (i) => {
    const el = gallery.current;
    if (!el) return;
    if (!stacked()) {
      el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
      return;
    }
    const box = media.current;
    const pin = stage.current;
    const sheetEl = scroller.current;
    if (!box || !pin || !sheetEl) return;
    const travel = box.offsetHeight - pin.offsetHeight;
    if (travel <= 0) return;
    const passed = pin.getBoundingClientRect().top - box.getBoundingClientRect().top;
    const want = travel * (i / Math.max(1, el.children.length - 1));
    sheetEl.scrollTo({ top: sheetEl.scrollTop + (want - passed), behavior: 'smooth' });
  };

  useEscape(open, onClose);
  useSheetFocus(scroller, open);

  /* Live stock wins; the catalog's cached flag stands in until it arrives. */
  const stock = useMemo(() => new Map((live?.variants ?? []).map((v) => [v.id, v])), [live]);
  const inStock = (v) => stock.get(v.id)?.available ?? v.available;

  const variant = useMemo(
    () => (p ? resolveVariant(p, Object.fromEntries(p.options.map((o, i) => [o.name, picks[i]]))) : null),
    [p, picks],
  );

  // swipe down from the top to leave — the gallery keeps its own sideways swipes
  useSwipeDismiss(scroller, onClose, { enabled: open });

  // data-lenis-prevent: opening this stops Lenis, and a stopped Lenis
  // preventDefaults every touchmove — including the ones meant for this page.
  // The ref goes on the placeholder too. React reconciles it with the real
  // sheet below as the same div.pdp, so the node is stable from first render
  // — without it the swipe effect ran once against a null element (the first
  // render after a product is picked still has cached === null) and, with
  // nothing in its deps changing afterwards, never re-attached.
  if (!cached) return <div className="pdp" aria-hidden="true" ref={scroller} data-lenis-prevent />;

  const bar = (
    <header className="pdp-bar">
      <button className="pdp-back label" onClick={onClose}>
        <span aria-hidden="true">←</span> Boutique
      </button>
      <button className="pdp-x label" onClick={onClose} aria-label="Close">Close</button>
    </header>
  );

  const sheet = (children, label) => (
    <div
      className={`pdp ${open ? 'on' : ''}`}
      role="dialog"
      aria-label={label}
      aria-hidden={!open}
      tabIndex={-1}
      ref={scroller}
      onScroll={onSheetScroll}
      data-lenis-prevent
    >
      {bar}
      {children}
    </div>
  );

  if (!p) {
    if (product.isError) {
      const gone = isNotFound(product.error);
      return sheet(
        <div className="co-done" role="alert">
          <h1 className="display d-md">{gone ? 'This piece is not here.' : 'This piece did not load.'}</h1>
          <p className="lede">
            {gone ? 'It may have sold through, or the link is out of date.' : 'Check your connection, then try again.'}
          </p>
          {!gone && <button className="btn" onClick={() => product.refetch()}>Try again</button>}
          <button className="btn solid" onClick={onClose}>Back to the boutique</button>
        </div>,
        'Product',
      );
    }
    return sheet(
      <div className="pdp-body" aria-busy="true">
        <div className="pdp-media">
          <div className="pdp-gallery"><div className="pdp-shot plate skel" /></div>
        </div>
        <aside className="pdp-buy">
          <div className="pdp-buy-inner">
            <span className="skel skel-line" style={{ width: '32%' }} />
            <span className="skel skel-line pdp-skel-name" />
            <span className="skel skel-line" style={{ width: '18%' }} />
          </div>
        </aside>
      </div>,
      'Loading product',
    );
  }

  const drop = featuredIn(p, store);
  // what the piece is: its type, or else the first collection it belongs to
  const category = p.productType || p.collections.find((cl) => cl.handle !== drop?.handle)?.title || '';
  const choices = p.options.map((o, index) => ({ ...o, index })).filter((o) => !isPlaceholderOption(o));
  /* Where a piece has sizes the chart hangs off that field; where it has none
     there is nothing to hang it on, so it gets a line of its own. Either way
     every piece in the shop can be measured against the house's chart. */
  const loneChart = !choices.some((o) => isSizeOption(o.name)) && hasSizeChart(store?.sizeChart);
  const missing = choices.find((o) => !picks[o.index]);
  const soldOut = variant ? !inStock(variant) : !p.available && !missing;
  const ready = !!variant && !soldOut;
  const price = variant ? variant.price : p.price;
  const was = variant ? variant.compareAtPrice : p.compareAtPrice;
  const level = variant ? stock.get(variant.id) : null;
  const low = level?.lowStock && level.quantity !== null ? `Only ${level.quantity} left` : null;

  /** Can this value still be bought, given what else is already picked? */
  const can = (index, value) =>
    p.variants.some((v) =>
      v.options[index] === value
      && p.options.every((_, j) => j === index || !picks[j] || v.options[j] === picks[j])
      && inStock(v));

  const pick = (index, value) => {
    setPicks((s) => ({ ...s, [index]: value }));
    setAdded(false);
  };

  const cta = soldOut
    ? 'Sold out'
    : ready
      ? `Add to bag — ${money(price)}`
      : `Select a ${isColourOption(missing?.name ?? '') ? 'colour' : (missing?.name ?? 'size').toLowerCase()}`;

  /* A dead button tells you nothing. If a choice is still missing, take the
     shopper to it and flash it rather than refusing the tap. */
  const submit = async () => {
    if (!variant) {
      fields.current[missing?.index ?? 0]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setNudge(true);
      setTimeout(() => setNudge(false), 900);
      return;
    }
    if (soldOut) { notify('Sold out'); return; }
    if (adding) return;
    setAdding(true);
    const ok = await add(p, variant.id);
    setAdding(false);
    if (ok) setAdded(true);
  };

  const priceLine = (
    <>
      {money(price)}
      {was ? <s className="price-was"><span className="sr-only">Was </span>{money(was)}</s> : null}
    </>
  );

  return sheet(
    <>
      <div className="pdp-body">
        {/* One markup for both: plates dealt by the scroll on a wide screen,
            a swipeable snapping row on a phone. */}
        <div className="pdp-media" ref={media} style={{ '--shots': p.images.length }}>
          <div className="pdp-stage" ref={stage}>
            <div className="pdp-gallery" ref={gallery} onScroll={onGalleryScroll}>
              {p.images.map((m, i) => (
                // --t: the plate starts one step below the one before it
                <figure className="pdp-shot plate packshot" key={m.id} style={{ '--t': i }}>
                  <img
              decoding="async"
                    src={imageSrc(m, 1400)}
                    srcSet={srcSet(m, [640, 960, 1400, 2000])}
                    sizes="(max-width: 900px) 100vw, 62vw"
                    alt={m.alt || `${p.title}${i ? ` — view ${i + 1}` : ''}`}
                    loading={i === 0 ? 'eager' : 'lazy'}
                  />
                  {p.images.length > 1 && (
                    <figcaption className="pdp-num label">{String(i + 1).padStart(2, '0')}</figcaption>
                  )}
                </figure>
              ))}
            </div>

            {p.images.length > 1 && (
              <>
                <div className="pdp-rail">
                  <span className="pdp-rail-track" aria-hidden="true"><i /></span>
                  <div className="pdp-rail-ns" role="tablist" aria-label="Views">
                    {p.images.map((m, i) => (
                      <button
                        key={m.id}
                        role="tab"
                        aria-selected={i === shot}
                        aria-label={`View ${i + 1}`}
                        className={`pdp-rail-n label ${i === shot ? 'on' : ''}`}
                        onClick={() => goToShot(i)}
                      >
                        {String(i + 1).padStart(2, '0')}
                      </button>
                    ))}
                  </div>
                </div>
                <span className="pdp-cue label" aria-hidden="true">Scroll</span>
              </>
            )}
          </div>

          {p.images.length > 1 && (
            <div className="pdp-marks" role="tablist" aria-label="Views">
              {p.images.map((m, i) => (
                <button
                  key={m.id}
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
            <div className="label muted">{[category, drop?.title].filter(Boolean).join(' · ')}</div>
            <h1 className="pdp-name display">{p.title}</h1>
            <div className="pdp-price">{priceLine}</div>
            {low && <span className="label pdp-low" role="status">{low}</span>}

            {p.descriptionHtml ? (
              // sanitized by the Worker before it is stored
              <div className="pdp-note" dangerouslySetInnerHTML={{ __html: p.descriptionHtml }} />
            ) : p.description ? (
              <p className="pdp-note">{p.description}</p>
            ) : null}

            {choices.map((o) => {
              const colour = isColourOption(o.name);
              // the store's chart belongs to the size field, and only if it has numbers in it
              const showChart = isSizeOption(o.name) && hasSizeChart(store?.sizeChart);
              return (
                <div
                  key={o.name}
                  className={`pdp-field ${nudge && missing?.index === o.index ? 'nudge' : ''}`}
                  ref={(el) => { fields.current[o.index] = el; }}
                  role="group"
                  aria-label={o.name}
                >
                  <div className="pdp-field-head">
                    <span className="label muted">{o.name}</span>
                    {showChart && (
                      <button
                        type="button"
                        className="label link-u pdp-chart-open"
                        aria-expanded={chart}
                        aria-controls="pdp-size-chart"
                        onClick={() => setChart((v) => !v)}
                      >
                        {chart ? 'Hide' : store.sizeChart.heading}
                      </button>
                    )}
                  </div>
                  <div className={colour ? 'swatches' : 'sizes'}>
                    {o.values.map(({ value, swatch }) => (
                      <button
                        key={value}
                        className={`${colour ? 'swatch' : 'size'} ${picks[o.index] === value ? 'on' : ''}`}
                        aria-pressed={picks[o.index] === value}
                        disabled={!can(o.index, value)}
                        onClick={() => pick(o.index, value)}
                      >
                        {colour && <i style={{ background: swatch || 'var(--sand)' }} />}
                        {value}
                      </button>
                    ))}
                  </div>
                  {showChart && chart && <SizeChart chart={store.sizeChart} id="pdp-size-chart" />}
                </div>
              );
            })}

            {/* The chart sits with the size buttons where there are any. A piece
                sold in a single size has none, and the house's measurements are
                worth reading there too — so it is given a line of its own. */}
            {loneChart && (
              <div className="pdp-field">
                <div className="pdp-field-head">
                  <span className="label muted">Measurements</span>
                  <button
                    type="button"
                    className="label link-u pdp-chart-open"
                    aria-expanded={chart}
                    aria-controls="pdp-size-chart"
                    onClick={() => setChart((v) => !v)}
                  >
                    {chart ? 'Hide' : store.sizeChart.heading}
                  </button>
                </div>
                {chart && <SizeChart chart={store.sizeChart} id="pdp-size-chart" />}
              </div>
            )}

            <button
              className={`btn solid block pdp-add ${ready ? '' : 'waiting'}`}
              onClick={submit}
              aria-busy={adding}
            >
              {added ? 'Added to your bag ✓' : cta}
            </button>

            <dl className="pdp-specs">
              {category && <div className="spec"><dt>Category</dt><dd>{category}</dd></div>}
              {choices.map((o) => (
                <div className="spec" key={o.name}>
                  <dt>{plural(o.name)}</dt>
                  <dd>{o.values.map((v) => v.value).join(', ')}</dd>
                </div>
              ))}
              <div className="spec">
                <dt>Exchanges</dt>
                <dd>
                  Within 24 hours of receiving, for a defect or a wrong item or size. Unworn,
                  unwashed, tags attached. No refunds — exchange only.{' '}
                  <Link className="link-u" to="/pages/exchange-policy">Exchange policy</Link>
                </dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>

      {look?.items.length > 0 && (
        <ShopTheLook key={p.id} product={p} items={look.items} curated={look.curated} onOpen={onOpen} />
      )}

      {/* Phone only: the price and the button stay in reach at any scroll depth. */}
      <div className="pdp-dock">
        <div className="pdp-dock-price">
          <span className="label muted">
            {choices.map((o) => picks[o.index]).filter(Boolean).join(' · ') || category}
          </span>
          <span className="card-price">{priceLine}</span>
        </div>
        <button className={`btn solid pdp-dock-add ${ready ? '' : 'waiting'}`} onClick={submit}>
          {added ? 'Added ✓' : soldOut ? 'Sold out' : 'Add to bag'}
        </button>
      </div>
    </>,
    p.title,
  );
}
