import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/queries';
import { LOGO, OPENING } from '../data/assets';

/**
 * The opening.
 *
 * One film and one logo, cut the same way on every screen. The film was a
 * Remotion composition — a picture composited frame by frame in JavaScript,
 * behind a 300 KB runtime — which a laptop never noticed and a phone could
 * not carry. It is now an ordinary video, which every device decodes in
 * hardware on a thread of its own, so the phone and the desktop finally see
 * the same thing.
 *
 * The cut:
 *
 *   the film runs full-bleed, drifting slowly, and loops — so it never
 *   rests on a frozen frame and the screen is never black;
 *   three seconds in, the picture is graded back and the house logo is
 *   drawn across it, out from the crown of the arch, opening out of the
 *   frame as it lands, its rule drawing beneath;
 *   then the lift is called.
 *
 * The logo is shown once and stays.
 */

/** A phone gets the light cut; anything larger, the better one. */
const SMALL = '(max-width: 900px), (hover: none) and (pointer: coarse)';
const pickCut = () =>
  typeof window !== 'undefined' && window.matchMedia(SMALL).matches ? OPENING[480] : OPENING[720];

/** How long the film is left to itself before the logo is drawn across it. */
const HOLD_MS = 3000;
/** If it never starts — Low Power Mode refuses it — the logo comes anyway,
    over the still that has been on screen all along. */
const NEVER_STARTED_MS = 6000;
/** The logo has settled: put up the lift. */
const AFTER_MARK_MS = 1400;
/** How much of the hero has to scroll away before the doors meet. */
const SHUT_AT = 0.7;

export default function Hero({ ready }) {
  // the film the owner uploaded, if any; otherwise the built-in campaign cut
  const uploaded = useStore().data?.home?.hero?.video?.url ?? null;
  const [cut] = useState(pickCut);
  const hero = useRef(null);
  const film = useRef(null);
  const [rolling, setRolling] = useState(false);
  const [shown, setShown] = useState(false);
  const [cue, setCue] = useState(false);
  const [called, setCalled] = useState(false);
  const land = useCallback(() => setShown(true), []);

  /* Three seconds from the moment the picture actually starts moving — and
     no more than six from the moment the page is ready, because it may never
     start at all and the still has been on screen the whole time anyway. */
  useEffect(() => {
    if (!rolling || shown) return;
    const t = setTimeout(land, HOLD_MS);
    return () => clearTimeout(t);
  }, [rolling, shown, land]);

  useEffect(() => {
    if (!ready || shown || rolling) return;
    const t = setTimeout(land, NEVER_STARTED_MS);
    return () => clearTimeout(t);
  }, [ready, shown, rolling, land]);

  useEffect(() => {
    if (!ready || cue || !shown) return;
    const t = setTimeout(() => setCue(true), AFTER_MARK_MS);
    return () => clearTimeout(t);
  }, [ready, cue, shown]);

  /* Low Power Mode, and some browsers, refuse to start a film on their own.
     The still is already on screen, so nothing looks broken — but ask again
     at the first touch and it plays. */
  useEffect(() => {
    const go = () => film.current?.play().catch(() => {});
    document.addEventListener('touchstart', go, { once: true, passive: true });
    document.addEventListener('click', go, { once: true });
    return () => {
      document.removeEventListener('touchstart', go);
      document.removeEventListener('click', go);
    };
  }, []);

  /* Nothing is decoded while the hero is off screen: the rest of the page
     scrolls against a film that has been put down, not one still running. */
  useEffect(() => {
    const el = film.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) el.play().catch(() => {});
        else el.pause();
      },
      { threshold: 0.02 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  /* Scrolling away rides the lift: the doors slide shut over the hero and
     the floor indicator rolls from 01 to 02. Written straight to a CSS
     variable, so scrolling never re-renders React. */
  useEffect(() => {
    const el = hero.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const p = Math.min(1, Math.max(0, window.scrollY / ((el.offsetHeight || 1) * SHUT_AT)));
      el.style.setProperty('--shut', (p * p * (3 - 2 * p)).toFixed(4));
      // back at the top: the call button goes dark again
      if (p === 0) setCalled(false);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, []);

  return (
    <section className="hero" id="top" ref={hero}>
      {/* the film opens on its own still, so nothing flashes before the
          first frame and nothing goes dark between passes */}
      <div className="hero-poster" aria-hidden="true" />

      <div className={`hero-film${shown ? ' is-shown' : ''}`}>
        <video
          className="hero-vid"
          ref={film}
          src={uploaded || cut}
          poster={OPENING.end}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden="true"
          style={{ backgroundImage: `url(${OPENING.end})` }}
          onPlaying={() => setRolling(true)}
        />

        {/* the picture is graded back under the logo — back, not out: the
            film goes on playing behind it */}
        <div className="hero-grade" aria-hidden="true" />

        <div className="hero-mark" aria-hidden="true">
          <i className="hero-mark-art" style={{ '--mark': `url(${LOGO.lockup})`, '--mark-ar': LOGO.ratio }} />
          <i className="hero-mark-rule" />
        </div>
      </div>

      <div className="hero-vig" />

      {/* each leaf carries half the monogram; it is whole only when they meet */}
      <div className="hero-doors" aria-hidden="true">
        <div className="hero-door is-left"><span>FDM</span></div>
        <div className="hero-door is-right"><span>FDM</span></div>
      </div>

      <div className="hero-chrome">
        <div className="hero-top">
          <div className="label">
            Follies d'Après-Midi <span className="hide-s">&nbsp;— Échappée 4 à 7</span>
          </div>
          <div className="label hide-s">Designed &amp; produced in Lebanon</div>
        </div>

        <div className="hero-bot">
          <a
            href="#maison"
            className={`lift${cue ? ' is-on' : ''}${called ? ' is-called' : ''}`}
            aria-label="Scroll down — take the elevator"
            aria-hidden={!cue}
            tabIndex={cue ? 0 : -1}
            data-cursor="Going down"
            onClick={() => setCalled(true)}
          >
            <span className="lift-plate" aria-hidden="true">
              <span className="lift-floor">
                <b className="lift-arrow" />
                <span className="lift-num"><span>01</span><span>02</span></span>
              </span>
              <span className="lift-btn">
                <svg viewBox="0 0 24 24" width="16" height="16">
                  <path d="M6 9.5l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </span>
            <span className="lift-cap label">Scroll — take the elevator</span>
          </a>
        </div>
      </div>
    </section>
  );
}
