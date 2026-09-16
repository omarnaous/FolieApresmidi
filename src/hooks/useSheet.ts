/**
 * What every full-screen sheet does the same way: Escape closes it, focus
 * moves in when it opens and back to where it was when it closes, and its
 * content lingers through the slide-out instead of vanishing first.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';

/** Escape calls `onEscape`, but only while `active` — a sheet underneath another must not close too. */
export function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onEscape]);
}

export function useSheetFocus(ref: RefObject<HTMLElement | null>, open: boolean) {
  useEffect(() => {
    if (!open) return undefined;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // a frame later, once the sheet is visible and can take focus
    const raf = requestAnimationFrame(() => ref.current?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(raf);
      // back where it was — unless that was inside an overlay that has since closed
      if (before && document.contains(before) && !before.closest('[aria-hidden="true"]')) {
        before.focus({ preventScroll: true });
      }
    };
  }, [open, ref]);
}

/** The last truthy `value`, held for `ms` after it goes away — long enough for the exit transition. */
export function useLinger<T>(value: T | null | undefined | false, ms = 620): T | null {
  const [held, setHeld] = useState<T | null>(value || null);
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    if (value) {
      setHeld(value);
      return undefined;
    }
    const t = setTimeout(() => {
      if (!latest.current) setHeld(null);
    }, ms);
    return () => clearTimeout(t);
  }, [value, ms]);

  return value || held;
}
