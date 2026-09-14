import { useEffect, useRef, useState } from 'react';

/** Fires once when an element crosses into the viewport. */
export function useInView({ threshold = 0.16, margin = '0px 0px -10% 0px', once = true } = {}) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return; }

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (once) io.unobserve(el);
        } else if (!once) setInView(false);
      },
      { threshold, rootMargin: margin }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold, margin, once]);

  return [ref, inView];
}
