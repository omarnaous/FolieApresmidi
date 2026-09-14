import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';


const FilmPlayer = lazy(() => import('./FilmPlayer'));

/**
 * The composition is cut to the viewport's own aspect ratio, so the
 * film is never letterboxed and never cropped. Every measurement in
 * HeroFilm is relative to useVideoConfig(), so the layout simply
 * re-flows — 21:9 desktop, 9:16 phone, anything between.
 */
const BASE_H = 1080;
const pickFormat = () => {
  if (typeof window === 'undefined') return { w: 1920, h: BASE_H };
  const ar = Math.min(2.4, Math.max(0.42, window.innerWidth / window.innerHeight));
  // quantised so a 1px resize doesn't remount the player
  const q = Math.round(ar * 50) / 50;
  return { w: Math.round((BASE_H * q) / 2) * 2, h: BASE_H };
};

export default function Hero({ ready }) {
  const player = useRef(null);
  const [fmt, setFmt] = useState(pickFormat);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    let t;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const next = pickFormat();
        setFmt((cur) => (cur.w === next.w && cur.h === next.h ? cur : next));
      }, 220);
    };
    window.addEventListener('resize', onResize);
    return () => { clearTimeout(t); window.removeEventListener('resize', onResize); };
  }, []);

  // hold the film on the leader until the curtain is up
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    if (ready) p.play();
  }, [ready, fmt]);

  const toggle = useCallback(() => {
    const p = player.current;
    if (!p) return;
    p.toggle();
    setPlaying(!p.isPlaying());
  }, []);

  const ar = fmt.w / fmt.h;

  return (
    <section className="hero" id="top">
      {/* the film opens on a black leader, so the poster is simply ink —
          nothing flashes before the first frame */}
      <div className="hero-poster" aria-hidden="true" />

      <div
        className="hero-film"
        style={{
          width: `max(100vw, calc(100svh * ${ar}))`,
          height: `max(100svh, calc(100vw / ${ar}))`,
        }}
      >
        <Suspense fallback={null}>
          <FilmPlayer playerRef={player} fmt={fmt} />
        </Suspense>
      </div>

      <div className="hero-vig" />

      <div className="hero-chrome">
        <div className="hero-top">
          <div className="label">
            Follies d'Après-Midi <span className="hide-s">&nbsp;— Échappée 4 à 7</span>
          </div>
          <div className="label hide-s">Designed &amp; produced in Lebanon</div>
        </div>

        <div className="hero-bot">
          <a href="#boutique" className="hero-scroll label" aria-label="Scroll to the boutique">
            <i />
            Scroll — Boutique
          </a>
          <button className="hero-ctrl label" onClick={toggle} aria-pressed={!playing}>
            <span className={`eq ${playing ? 'on' : ''}`}><b /><b /><b /></span>
            {playing ? 'Pause film' : 'Play film'}
          </button>
        </div>
      </div>
    </section>
  );
}
