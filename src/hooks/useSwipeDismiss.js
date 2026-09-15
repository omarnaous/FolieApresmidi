import { useEffect } from 'react';

/**
 * Swipe down to leave a full-page sheet.
 *
 * Two guards keep it from stealing gestures that mean something else:
 *   - it only arms at the very top of the sheet, so a normal scroll is never
 *     mistaken for a dismissal
 *   - it drops the moment a gesture looks more horizontal than vertical, so a
 *     carousel inside the sheet keeps its own swipes
 *
 * The sheet follows the finger, damped, so the gesture is visible before it
 * commits; releasing under the threshold springs it back.
 */
export function useSwipeDismiss(ref, onDismiss, { enabled = true, threshold = 90 } = {}) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return undefined;

    let startX = 0;
    let startY = 0;
    let dy = 0;
    let armed = false;

    const reset = () => {
      el.style.transition = '';
      el.style.transform = '';
    };

    const start = (e) => {
      if (e.touches.length !== 1) { armed = false; return; }
      armed = el.scrollTop <= 0;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dy = 0;
    };

    const move = (e) => {
      if (!armed) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      dy = t.clientY - startY;
      // upward, or more sideways than down: not a dismissal
      if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
        armed = false;
        reset();
        return;
      }
      el.style.transition = 'none';
      el.style.transform = `translate3d(0, ${Math.min(dy * 0.42, 150)}px, 0)`;
    };

    const end = () => {
      if (!armed) return;
      armed = false;
      const go = dy > threshold;
      reset();
      if (go) onDismiss();
    };

    // passive: nothing here calls preventDefault, so the scroller stays smooth
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('touchend', end, { passive: true });
    el.addEventListener('touchcancel', end, { passive: true });

    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
      reset();
    };
  }, [ref, onDismiss, enabled, threshold]);
}
