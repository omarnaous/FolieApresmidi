import React, { useEffect, useMemo, useRef, useState } from 'react';
import PieceCard, { PieceSkeletons } from './PieceCard';
import { useInView } from '../hooks/useInView';
import { useRail } from '../hooks/useRail';
import { featuredIn } from '../lib/catalog';
import { homeGridQuery, useProductList, useStore } from '../lib/queries';

/** How long the cards take to fold away before the next set deals in. */
const LEAVE_MS = 380;
const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const pad = (n) => String(n).padStart(2, '0');

const Arrow = ({ flip }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
    <path d="m9 5 7 7-7 7" />
  </svg>
);

/**
 * One row of the boutique: up to ten pieces from a collection on a sideways
 * rail. The parent owns which collection; when it changes, the cards on
 * screen fold away, and only then does the next set deal in — whether it
 * came from the network or was already cached, the order is the same.
 *
 *   phase   idle → leaving → waiting → idle
 *   shown   what is on the rail, which lags `collection` by one leave
 */
export default function Shelf({ id, collection, accessory, label, onOpen, onAll, allNoun = 'pieces' }) {
  const { data: store } = useStore();
  const { data, isError, isPlaceholderData, refetch } = useProductList(homeGridQuery(collection, accessory));
  const key = `${collection ?? 'all'}:${accessory ?? 'both'}`;

  const [shown, setShown] = useState(null);
  const [phase, setPhase] = useState('idle');
  const timer = useRef(0);
  const lastKey = useRef(key);

  const rail = useRail();
  const { reset, measure } = rail;
  const [stage, onStage] = useInView({ threshold: 0.12 });

  // the collection changed: fold what is on screen away first
  useEffect(() => {
    if (lastKey.current === key) return;
    lastKey.current = key;
    clearTimeout(timer.current);
    if (reduced() || !shown) {
      setPhase('waiting');
      return;
    }
    setPhase('leaving');
    timer.current = setTimeout(() => setPhase('waiting'), LEAVE_MS);
  }, [key, shown]);

  useEffect(() => () => clearTimeout(timer.current), []);

  // put real data on the rail when it is this collection's and the rail is ready for it
  useEffect(() => {
    if (!data || isPlaceholderData) return;
    const next = { key, items: data.items, total: data.total };
    if (!shown) {
      setShown(next);
      setPhase('idle');
      return;
    }
    if (shown.key === key) {
      if (shown.items !== data.items) setShown(next);   // a refetch: swap in place
      if (phase === 'waiting') setPhase('idle');         // picked the row that was already up
      return;
    }
    if (phase === 'waiting') {
      reset();
      setShown(next);
      setPhase('idle');
    }
  }, [data, isPlaceholderData, key, shown, phase, reset]);

  const items = shown?.items ?? [];
  const total = shown?.total ?? 0;
  useEffect(() => { measure(); }, [items.length, measure]);

  // only name the drop on a card when the row holds more than the drop
  const mixed = useMemo(
    () => items.some((p) => featuredIn(p, store)) && items.some((p) => !featuredIn(p, store)),
    [items, store],
  );

  if (isError && !shown) {
    return (
      <div className="cat-empty" role="alert">
        <span className="display d-sm">This shelf did not load.</span>
        <span className="label muted">Check your connection, then try again.</span>
        <button className="btn" onClick={() => refetch()}>Try again</button>
      </div>
    );
  }
  if (shown && items.length === 0 && phase === 'idle') {
    return (
      <div className="cat-empty">
        <span className="display d-sm">Nothing here yet.</span>
        <span className="label muted">Produced in limited quantities.</span>
      </div>
    );
  }

  const state = phase === 'leaving' ? 'leaving'
    : phase === 'waiting' ? 'waiting'
      : onStage && shown ? 'dealt' : 'ready';
  const count = rail.count || items.length;

  return (
    <>
      <div
        className="shelf"
        ref={stage}
        data-state={state}
        role="region"
        aria-roledescription="carousel"
        aria-label={label}
        aria-busy={phase !== 'idle' || !shown}
      >
        <div
          className="shelf-track"
          {...rail.bind}
          id={id}
          tabIndex={-1}
          // a sideways swipe belongs to the rail; an up/down one still scrolls the page smoothly
          data-lenis-prevent-horizontal
        >
          <div className="shelf-row" key={shown?.key ?? 'loading'}>
            {!shown ? (
              <PieceSkeletons count={5} />
            ) : (
              items.map((p, i) => (
                <PieceCard
                  key={p.id}
                  rail
                  product={p}
                  index={i}
                  total={items.length}
                  onOpen={onOpen}
                  showDrop={mixed}
                />
              ))
            )}
          </div>
        </div>

        <button
          type="button"
          className="shelf-arrow prev"
          onClick={rail.prev}
          aria-controls={id}
          aria-label={`Previous ${allNoun}`}
          disabled={rail.atStart}
          data-cursor="Back"
        >
          <Arrow flip />
        </button>
        <button
          type="button"
          className="shelf-arrow next"
          onClick={rail.next}
          aria-controls={id}
          aria-label={`More ${allNoun}`}
          disabled={rail.atEnd}
          data-cursor="More"
        >
          <Arrow />
        </button>
      </div>

      {total > 0 && (
        <div className="shelf-foot">
          <div className="shelf-count" aria-hidden="true">
            <span className="shelf-now"><b key={rail.index}>{pad(Math.min(rail.index + 1, count))}</b></span>
            <span className="shelf-of">/ {pad(count)}</span>
          </div>
          <div
            className="shelf-bar"
            role="presentation"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              rail.goTo(Math.round(((e.clientX - r.left) / r.width) * (count - 1)));
            }}
          >
            <i
              style={{
                width: `${Math.max(8, rail.window * 100)}%`,
                left: `${rail.progress * (100 - Math.max(8, rail.window * 100))}%`,
              }}
            />
          </div>
          <button className="btn shelf-all" onClick={() => onAll(shown?.key === 'all' ? null : shown?.key)} data-cursor="All">
            See all {total} {allNoun} <span aria-hidden="true">→</span>
          </button>
        </div>
      )}
    </>
  );
}
