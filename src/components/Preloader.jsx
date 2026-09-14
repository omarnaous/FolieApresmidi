import React, { useEffect, useRef, useState } from 'react';
import { CRITICAL } from '../data/assets';

const MIN_MS = 1500;

export default function Preloader({ onDone }) {
  const [pct, setPct] = useState(0);
  const [done, setDone] = useState(false);
  const started = useRef(Date.now());

  useEffect(() => {
    let loaded = 0;
    let cancelled = false;
    const total = CRITICAL.length;

    const tick = () => {
      loaded += 1;
      if (!cancelled) setPct(Math.round((loaded / total) * 100));
    };

    CRITICAL.forEach((src) => {
      const img = new Image();
      img.onload = tick;
      img.onerror = tick;
      img.src = src;
    });

    // never hold the door longer than 4s, whatever the network does
    const bail = setTimeout(() => !cancelled && setPct(100), 4000);
    return () => { cancelled = true; clearTimeout(bail); };
  }, []);

  useEffect(() => {
    if (pct < 100) return;
    const wait = Math.max(0, MIN_MS - (Date.now() - started.current));
    const t = setTimeout(() => { setDone(true); onDone?.(); }, wait);
    return () => clearTimeout(t);
  }, [pct, onDone]);

  return (
    <div className={`preload ${done ? 'done' : ''}`} aria-hidden={done}>
      <div className="preload-in">
        <div className="preload-mono">{String(pct).padStart(3, '0')}</div>
        <div className="preload-bar"><i style={{ width: `${pct}%` }} /></div>
        <div className="preload-cap label">Follies d'Après Midi — Beirut</div>
      </div>
    </div>
  );
}
