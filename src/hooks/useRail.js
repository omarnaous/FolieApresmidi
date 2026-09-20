import { useCallback, useEffect, useRef, useState } from 'react';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** How far the cards lean for a given scroll speed, and how quickly they settle. */
const LEAN_PER_PX_MS = 3.2;
const MAX_LEAN_DEG = 6;
const SETTLE = 0.14;
/** How long after the last scroll event the rail is considered still. */
const IDLE_MS = 140;

/**
 * A horizontal rail of cards: where it is, which card leads, and the motion
 * layered on top.
 *
 *   --lean   set on the track; each card body skews by it, so the row bends
 *            with the speed of travel and springs straight when it stops
 *   --p      set on each card, -1 (left edge) … 1 (right edge); the picture
 *            inside drifts against it, so the garment floats in its plate
 *
 * The loop only runs while something is moving. Touch scrolls natively; a
 * mouse can drag, and a fling carries on to the card it was heading for.
 *
 * Every measurement the frame loop needs is taken once, in `survey`, and
 * read from there afterwards. Asking the browser for a card's box while the
 * rail is moving forces it to lay the page out again — sixty times a second,
 * once per card, on a row of full-width photographs — and that is felt on a
 * phone as a rail that stutters and drags.
 */
export function useRail() {
  const track = useRef(null);
  const [pos, setPos] = useState({ index: 0, count: 0, atStart: true, atEnd: true, progress: 0, window: 1 });
  const motion = useRef({ lean: 0, target: 0, lastX: 0, lastT: 0, raf: 0, idle: 0 });
  const geom = useRef({ start: 0, clear: 0, list: [] });
  const drag = useRef(null);

  const cards = () => (track.current ? [...track.current.querySelectorAll('[data-rail-card]')] : []);

  /**
   * The one place the layout is read. A card's offsetLeft is measured from
   * the row (the row is position: relative), and the row starts after the
   * track's left padding.
   */
  const survey = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const css = getComputedStyle(el);
    geom.current = {
      start: parseFloat(css.paddingLeft) || 0,
      clear: parseFloat(css.scrollPaddingLeft) || 0,
      list: cards().map((c) => ({ el: c, left: c.offsetLeft, w: c.offsetWidth })),
    };
  }, []);

  /**
   * The scrollLeft at which each card snaps into place — from the survey, so
   * the deal and the lean, both transforms, can never move the stops.
   */
  const stops = () => {
    const el = track.current;
    if (!el) return [];
    const { start, clear, list } = geom.current;
    const max = Math.max(0, el.scrollWidth - el.clientWidth);
    return list.map((c) => clamp(start + c.left - clear, 0, max));
  };

  /** Where each card sits in the window, -1 … 1 — arithmetic, not boxes. */
  const drift = () => {
    const el = track.current;
    if (!el) return;
    const { start, list } = geom.current;
    const w = el.clientWidth;
    if (!w) return;
    const x = el.scrollLeft;
    for (const c of list) {
      const from = start + c.left + c.w / 2 - x;
      // nowhere near the window: leave it as it was
      if (from < -w || from > w * 2) continue;
      c.el.style.setProperty('--p', clamp((from - w / 2) / w, -1, 1).toFixed(3));
    }
  };

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const max = Math.max(0, el.scrollWidth - el.clientWidth);
    const x = el.scrollLeft;
    const s = stops();
    let index = 0;
    for (let i = 0; i < s.length; i += 1) if (Math.abs(s[i] - x) < Math.abs(s[index] - x)) index = i;
    const next = {
      index,
      count: s.length,
      atStart: x <= 4,
      atEnd: x >= max - 4,
      progress: max ? x / max : 0,
      window: el.scrollWidth ? el.clientWidth / el.scrollWidth : 1,
    };
    setPos((p) =>
      p.index === next.index && p.count === next.count && p.atStart === next.atStart && p.atEnd === next.atEnd
        && Math.abs(p.progress - next.progress) < 0.002 && Math.abs(p.window - next.window) < 0.002
        ? p
        : next,
    );
  }, []);

  /** Survey, then place: for a new set of cards, or a new size. */
  const remeasure = useCallback(() => {
    survey();
    measure();
    drift();
  }, [survey, measure]);

  const loop = useCallback(() => {
    const m = motion.current;
    const el = track.current;
    if (!el) return;
    const idleFor = performance.now() - m.idle;
    if (idleFor > 70) m.target = 0;
    m.lean += (m.target - m.lean) * SETTLE;
    if (Math.abs(m.lean) < 0.01 && m.target === 0) m.lean = 0;
    el.style.setProperty('--lean', `${m.lean.toFixed(2)}deg`);
    drift();
    // while the rail is moving, or still settling from it
    m.raf = m.lean !== 0 || m.target !== 0 || idleFor < IDLE_MS ? requestAnimationFrame(loop) : 0;
  }, []);

  const kick = useCallback(() => {
    const m = motion.current;
    if (!m.raf) m.raf = requestAnimationFrame(loop);
  }, [loop]);

  // scroll → position, speed → lean
  useEffect(() => {
    const el = track.current;
    if (!el) return undefined;
    const still = reduced();
    /* The counter and the bar want the new position, but once a frame is
       enough: a scroll event fires far more often than the screen paints. */
    let mraf = 0;
    const place = () => {
      if (mraf) return;
      mraf = requestAnimationFrame(() => { mraf = 0; measure(); });
    };
    const onScroll = () => {
      place();
      if (still) return;
      const m = motion.current;
      const now = performance.now();
      const dt = Math.max(1, now - m.lastT);
      const v = (el.scrollLeft - m.lastX) / dt;
      if (now - m.lastT < 120) m.target = clamp(-v * LEAN_PER_PX_MS, -MAX_LEAN_DEG, MAX_LEAN_DEG);
      m.lastX = el.scrollLeft;
      m.lastT = now;
      m.idle = now;
      kick();
    };
    const onResize = () => remeasure();
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    ro?.observe(el);
    onResize();
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
      cancelAnimationFrame(mraf);
      cancelAnimationFrame(motion.current.raf);
      motion.current.raf = 0;
    };
  }, [measure, remeasure, kick]);

  const goTo = useCallback((i, behavior = 'smooth') => {
    const el = track.current;
    const s = stops();
    if (!el || !s.length) return;
    el.scrollTo({ left: s[clamp(i, 0, s.length - 1)], behavior: reduced() ? 'auto' : behavior });
  }, []);

  /** A page at a time: as many cards as are fully in view. */
  const perView = () => {
    const el = track.current;
    const { list, clear } = geom.current;
    if (!el || list.length < 2) return 1;
    const step = list[1].left - list[0].left;
    return step > 0 ? Math.max(1, Math.floor((el.clientWidth - clear) / step)) : 1;
  };
  const prev = useCallback(() => goTo(pos.index - perView()), [goTo, pos.index]);
  const next = useCallback(() => goTo(pos.index + perView()), [goTo, pos.index]);

  const reset = useCallback(() => {
    // 'instant' also cancels a smooth scroll still under way from an arrow
    track.current?.scrollTo({ left: 0, behavior: 'instant' });
    remeasure();
  }, [remeasure]);

  /* ── mouse drag ─────────────────────────────────────────── */

  const onPointerDown = (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('button')) return;
    const el = track.current;
    drag.current = { x: e.clientX, left: el.scrollLeft, moved: 0, lastX: e.clientX, lastT: performance.now(), v: 0, id: e.pointerId };
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const el = track.current;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 6) return;
    if (!d.moved) {
      try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      el.classList.add('is-dragging');
    }
    d.moved = Math.abs(dx);
    const now = performance.now();
    d.v = (e.clientX - d.lastX) / Math.max(1, now - d.lastT);
    d.lastX = e.clientX;
    d.lastT = now;
    el.scrollLeft = d.left - dx;
  };

  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.moved) return;
    const el = track.current;
    try { el.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    // the drag was a gesture, not a click on whatever it ended over
    const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    el.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => el.removeEventListener('click', swallow, { capture: true }), 0);

    // carry the fling, then land on a card
    const s = stops();
    const aim = el.scrollLeft - d.v * 260;
    let i = 0;
    for (let k = 0; k < s.length; k += 1) if (Math.abs(s[k] - aim) < Math.abs(s[i] - aim)) i = k;
    el.scrollTo({ left: s[i] ?? 0, behavior: reduced() ? 'auto' : 'smooth' });
    const release = () => el.classList.remove('is-dragging');
    if ('onscrollend' in el) el.addEventListener('scrollend', release, { once: true });
    else setTimeout(release, 520);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(pos.index + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(pos.index - 1); }
  };

  const bind = {
    ref: track,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onKeyDown,
  };

  return { bind, track, ...pos, prev, next, goTo, reset, measure: remeasure };
}
