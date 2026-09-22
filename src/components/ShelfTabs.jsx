import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** How long the underline stays stretched across both tabs before it settles. */
const STRETCH_MS = 170;

/**
 * Category tabs for a boutique shelf: words, not chips, and a single rule
 * under the one that is on. On a change the rule first stretches to span
 * the old tab and the new, then lets go of the old one — so it reads as
 * travelling rather than jumping.
 *
 * A tablist: arrows move between tabs, Enter or Space picks. Hovering or
 * focusing a tab calls `onPreview`, which the shelf uses to fetch ahead.
 */
export default function ShelfTabs({ options, value, onChange, onPreview, controls, label }) {
  const list = useRef(null);
  const tabs = useRef([]);
  const last = useRef(null);
  const selected = Math.max(0, options.findIndex((o) => o.value === value));
  const [focus, setFocus] = useState(selected);
  const [ink, setInk] = useState(null);

  // letter-spacing also pads the right of the last letter; the rule stops at the letter
  const place = (el) => ({
    x: el.offsetLeft,
    w: el.offsetWidth - (parseFloat(getComputedStyle(el).letterSpacing) || 0),
  });

  // follow the selected tab
  useLayoutEffect(() => {
    const el = tabs.current[selected];
    if (!el) return undefined;
    const next = place(el);
    const prev = last.current;
    last.current = next;
    centre(list.current, el);
    if (!prev || reduced() || (prev.x === next.x && prev.w === next.w)) {
      setInk(next);
      return undefined;
    }
    const x = Math.min(prev.x, next.x);
    setInk({ x, w: Math.max(prev.x + prev.w, next.x + next.w) - x });
    const t = setTimeout(() => setInk(next), STRETCH_MS);
    return () => clearTimeout(t);
  }, [selected, options.length]);

  // Widths change when the webfont lands or the window resizes: snap, don't
  // glide. Only when a tab actually moved — a ResizeObserver also fires the
  // moment it is attached, and that must not cut a stretch short.
  const current = useRef(selected);
  current.current = selected;
  useEffect(() => {
    const snap = () => {
      const el = tabs.current[current.current];
      if (!el) return;
      const at = place(el);
      if (last.current && at.x === last.current.x && at.w === last.current.w) return;
      last.current = at;
      setInk(at);
    };
    document.fonts?.ready.then(snap);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(snap) : null;
    if (list.current) ro?.observe(list.current);
    return () => ro?.disconnect();
  }, []);

  useEffect(() => setFocus(selected), [selected]);

  const onKeyDown = (e) => {
    const lastIndex = options.length - 1;
    const to = {
      ArrowRight: focus >= lastIndex ? 0 : focus + 1,
      ArrowLeft: focus <= 0 ? lastIndex : focus - 1,
      Home: 0,
      End: lastIndex,
    }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    setFocus(to);
    tabs.current[to]?.focus();
  };

  /* One tab is not a choice, but it is still a name: where a shelf holds a
     single collection the word stands over it, underlined, the way the
     others do. Nothing at all is what an empty row gets. */
  if (options.length === 0) return null;

  return (
    <div className="tabs" role="tablist" aria-label={label} ref={list} onKeyDown={onKeyDown}>
      {options.map((o, i) => (
        <button
          key={o.value ?? 'all'}
          ref={(el) => { tabs.current[i] = el; }}
          type="button"
          role="tab"
          id={`${controls}-tab-${i}`}
          aria-selected={i === selected}
          aria-controls={controls}
          tabIndex={i === focus ? 0 : -1}
          className={`tab${i === selected ? ' on' : ''}`}
          onClick={() => i !== selected && onChange(o.value)}
          onPointerEnter={() => onPreview?.(o.value)}
          onFocus={() => { setFocus(i); onPreview?.(o.value); }}
        >
          {o.label}
        </button>
      ))}
      <span
        className="tabs-ink"
        aria-hidden="true"
        style={ink ? { width: ink.w, transform: `translateX(${ink.x}px)` } : { opacity: 0 }}
      />
    </div>
  );
}

/** Keep the chosen tab in view when the row scrolls (phones). */
function centre(row, el) {
  if (!row || row.scrollWidth <= row.clientWidth) return;
  const left = el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2;
  row.scrollTo({ left: Math.max(0, left), behavior: reduced() ? 'auto' : 'smooth' });
}
