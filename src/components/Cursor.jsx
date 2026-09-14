import React, { useEffect, useRef } from 'react';

/** A single dot that lerps toward the pointer and swells into a
 *  labelled disc over anything carrying `data-cursor="…"`. */
export default function Cursor() {
  const dot = useRef(null);
  const labelRef = useRef(null);

  useEffect(() => {
    if (window.matchMedia('(pointer: coarse)').matches) return;
    const el = dot.current;
    let x = window.innerWidth / 2, y = window.innerHeight / 2;
    let tx = x, ty = y, raf;

    const move = (e) => {
      tx = e.clientX; ty = e.clientY;
      const hit = e.target.closest?.('[data-cursor]');
      if (hit) {
        el.classList.add('wide');
        labelRef.current.textContent = hit.dataset.cursor;
      } else {
        el.classList.remove('wide');
      }
    };

    const loop = () => {
      x += (tx - x) * 0.18;
      y += (ty - y) * 0.18;
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      raf = requestAnimationFrame(loop);
    };

    window.addEventListener('pointermove', move, { passive: true });
    loop();
    return () => { window.removeEventListener('pointermove', move); cancelAnimationFrame(raf); };
  }, []);

  return (
    <div className="cursor" ref={dot} aria-hidden="true">
      <span ref={labelRef} />
    </div>
  );
}
