import React, { useEffect, useRef, useState } from 'react';
import { imageSrc } from '../../shared/api';
import { homeGridQuery, useProductList } from '../lib/queries';

const MIN_MS = 1500;
/** How long the door waits on the catalogue before it stops counting it. */
const API_MS = 1800;
/** First shots of the home grid, warmed once the catalogue answers. */
const WARM = 2;

const load = (srcs, tick) => {
  srcs.forEach((src) => {
    const img = new Image();
    img.onload = tick;
    img.onerror = tick;
    img.src = src;
  });
};

export default function Preloader({ onDone }) {
  const [loaded, setLoaded] = useState(0);
  const [bailed, setBailed] = useState(false);
  // null while the catalogue has not answered; [] once it failed or was too slow
  const [warm, setWarm] = useState(null);
  const [done, setDone] = useState(false);
  const started = useRef(Date.now());
  // the grid's own request, so this warms the cache rather than racing it
  const { data, isError } = useProductList(homeGridQuery(null));

  useEffect(() => {
    let cancelled = false;
    // never hold the door longer than 4s, whatever the network does
    const bail = setTimeout(() => !cancelled && setBailed(true), 4000);
    const giveUp = setTimeout(() => setWarm((w) => w ?? []), API_MS);
    return () => { cancelled = true; clearTimeout(bail); clearTimeout(giveUp); };
  }, []);

  useEffect(() => {
    if (warm !== null) return;
    if (data) {
      setWarm(data.items.slice(0, WARM).flatMap((p) => (p.images[0] ? [imageSrc(p.images[0], 640)] : [])));
    } else if (isError) {
      setWarm([]);
    }
  }, [data, isError, warm]);

  useEffect(() => {
    if (!warm?.length) return;
    let cancelled = false;
    load(warm, () => !cancelled && setLoaded((n) => n + 1));
    return () => { cancelled = true; };
  }, [warm]);

  // the hero film is video and streams on its own; the door only waits on the grid
  const total = warm === null ? WARM : warm.length;
  const pct = bailed || total === 0 ? 100 : Math.min(100, Math.round((loaded / total) * 100));

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
