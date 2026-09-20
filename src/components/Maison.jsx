import React, { useEffect, useRef, useState } from 'react';
import Reveal from './Reveal';
import { imageSrc } from '../../shared/api';
import { useEyebrow } from '../data/sections';
import { srcSet } from '../lib/catalog';
import { useStore } from '../lib/queries';
import { emphasis } from '../lib/emphasis';

/** How long the doors take to meet, and the whole ride. Mirrors the CSS keyframes. */
const DOORS_SHUT_MS = 330;
const RIDE_MS = 900;

const pad = (n) => String(n).padStart(2, '0');
const hrefOf = (f) => `/collections/${f.collectionHandle ?? 'all'}`;

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Maison FDM: the house as a lift directory. Each floor is a collection the
 * owner names and pictures in the admin. Choosing a floor calls the car —
 * the doors close over the plate, the picture changes behind them, and they
 * part on the new floor. Choosing the floor you are on steps out into it.
 */
export default function Maison({ onOpen }) {
  const eyebrow = useEyebrow('#maison');
  const { data: store } = useStore();
  const home = store?.home;
  const floors = home?.floors ?? [];

  const [at, setAt] = useState(0);        // the lit button
  const [shown, setShown] = useState(0);  // the picture behind the doors
  const [ride, setRide] = useState(0);    // bumps to replay the doors
  const [dir, setDir] = useState('up');
  const [moving, setMoving] = useState(false);
  const timers = useRef([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const go = (n) => {
    if (n === at) return;
    setDir(n > at ? 'up' : 'down');
    setAt(n);
    timers.current.forEach(clearTimeout);
    if (reducedMotion()) {
      setShown(n);
      return;
    }
    setRide((r) => r + 1);
    setMoving(true);
    timers.current = [
      setTimeout(() => setShown(n), DOORS_SHUT_MS),
      setTimeout(() => setMoving(false), RIDE_MS),
    ];
  };

  const enter = (f) => onOpen?.(f.collectionHandle ?? null);

  return (
    <section className="section shell tight-top" id="maison">
      <div className="sec-head">
        <div>
          <div className="label muted" style={{ marginBottom: 14 }}>{eyebrow}</div>
          <h2 className="display d-md">{home ? emphasis(home.maison.heading) : ' '}</h2>
        </div>
        {home?.maison.intro && <p className="maison-intro">{home.maison.intro}</p>}
      </div>

      <div className="floors">
        {/* data-dir lets the plate ride the right way on a phone, where the
            panel sits on the picture instead of under it */}
        <Reveal variant="rv-mask" className="floors-stage rv-img" data-dir={dir}>
          {floors.map((f, n) => (
            <a
              key={n}
              className={`floors-shot ${n === shown ? 'on' : ''}`}
              href={hrefOf(f)}
              onClick={(e) => { e.preventDefault(); enter(f); }}
              tabIndex={-1}
              aria-hidden="true"
              data-cursor="Step in"
            >
              {f.image && (
                <img
              decoding="async"
                  src={imageSrc(f.image, 960)}
                  srcSet={srcSet(f.image, [640, 960, 1400])}
                  sizes="(max-width: 860px) 100vw, 50vw"
                  alt=""
                  loading="lazy"
                />
              )}
            </a>
          ))}

          <span key={ride} className={`floors-doors${ride ? ' go' : ''}`} aria-hidden="true">
            <i><b>FDM</b></i>
            <i><b>FDM</b></i>
          </span>

          {floors.length > 0 && (
            <span className={`floors-dial${moving ? ' moving' : ''}`} aria-hidden="true">
              <span className={`floors-dir is-${dir}`} />
              <span className="floors-at">{pad(at + 1)}</span>
            </span>
          )}
          <span className="floors-plate" aria-hidden="true">
            <span className="floors-stamp label">{floors[shown]?.name}</span>
          </span>
        </Reveal>

        <ol className="floors-index" aria-label="Floors">
          {(floors.length ? floors : [null, null, null, null]).map((f, n) =>
            f ? (
              <li key={n}>
                <a
                  className={`floors-row ${n === at ? 'on' : ''}`}
                  href={hrefOf(f)}
                  aria-current={n === at ? 'true' : undefined}
                  // a mouse calls the car by hovering; a finger taps once to call, again to step in
                  onPointerEnter={(e) => e.pointerType === 'mouse' && go(n)}
                  onFocus={(e) => e.currentTarget.matches(':focus-visible') && go(n)}
                  onClick={(e) => {
                    e.preventDefault();
                    if (n === at) enter(f);
                    else go(n);
                  }}
                  data-cursor={n === at ? 'Step in' : 'Call'}
                >
                  <span className="floors-btn" aria-hidden="true">{n + 1}</span>
                  <span className="floors-text">
                    <span className="floors-name">{f.name}</span>
                    {f.line && <span className="floors-line">{f.line}</span>}
                  </span>
                  <span className="label floors-go">{n === at ? 'Step in →' : `Floor ${pad(n + 1)}`}</span>
                </a>
              </li>
            ) : (
              <li key={n} aria-hidden="true"><span className="floors-row is-blank" /></li>
            ),
          )}
        </ol>
      </div>
    </section>
  );
}
