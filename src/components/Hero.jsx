import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/queries';
import { OPENING } from '../data/assets';

/**
 * The opening: the film, and nothing over it.
 *
 * It was a Remotion composition — a picture composited frame by frame in
 * JavaScript behind a 300 KB runtime — which a laptop never noticed and a
 * phone could not carry. It is now an ordinary video, decoded in hardware
 * on a thread of its own, so a phone and a desktop see the same thing.
 *
 * It loops, so it never rests on a frozen frame and the screen is never
 * black, and its own last still sits behind it for the moments before it
 * starts. Nothing is drawn on top of it: no grade, no vignette, no logo.
 */

/**
 * Which cut to play. The plate is locked off and compresses hard enough that
 * the whole 1440×1080 master is 1 MB — less than the phone was being sent
 * when it was given a 640×480 one — so every screen gets the full picture.
 * A phone was the reason for the small cut, and the small cut was the reason
 * the film looked soft: a 480-line source has to be stretched five times to
 * fill a tall screen.
 *
 * What still earns a lighter cut is a connection the browser says is metered
 * or genuinely slow. Only those two: Chrome calls a great many usable
 * connections "3g", and a megabyte is not worth a soft picture over that.
 * Safari does not answer at all, which reads as no reason to hold back.
 */
const thrifty = () => {
  const c = typeof navigator !== 'undefined' ? navigator.connection : undefined;
  return !!c && (c.saveData === true || ['slow-2g', '2g'].includes(c.effectiveType));
};
const pickCut = () => (thrifty() ? OPENING[480] : OPENING[1080]);

/** Whether this browser says it can play a film of this type ("" means no). */
const playable = (type) => {
  if (!type || typeof document === 'undefined') return true;
  try {
    return document.createElement('video').canPlayType(type) !== '';
  } catch {
    return true;
  }
};

/** A phone held upright: the one screen a landscape film cannot fill without losing its sides. */
const UPRIGHT = '(orientation: portrait) and (max-width: 900px)';
const useUpright = () => {
  const [upright, setUpright] = useState(() => typeof window !== 'undefined' && window.matchMedia(UPRIGHT).matches);
  useEffect(() => {
    const mq = window.matchMedia(UPRIGHT);
    const on = () => setUpright(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return upright;
};

/** Cropping more than this share of a film's width to fill the screen is too much: show it whole instead. */
const MAX_CROP = 0.3;

export default function Hero() {
  /* The film the owner uploaded, if any; otherwise the built-in campaign cut.
     The upload carries its codec (read in the admin), so a browser that cannot
     play it — an HEVC film in Chrome on Android, say — is told before it
     tries, and plays the house film. One that says yes and then fails to
     decode falls back the same way. Until the store has answered nothing
     loads, so the house film never flashes up before the owner's.

     On a phone held upright the owner's vertical cut plays, if there is one.
     Without one, a landscape film would be cut to its middle third to fill a
     tall screen — so it is shown whole instead, across the middle, over a
     soft, darkened copy of itself that fills the rest. */
  const store = useStore();
  const hero = store.data?.home?.hero;
  const upright = useUpright();
  const [cut] = useState(pickCut);
  const [failed, setFailed] = useState(() => new Set());
  const usable = (url, type) => !!url && !failed.has(url) && playable(type);
  const phoneUrl = hero?.phone?.url ?? null;
  const ownUrl = hero?.video?.url ?? null;
  const kind = upright && usable(phoneUrl, hero?.phoneType) ? 'phone' : usable(ownUrl, hero?.type) ? 'own' : 'house';
  const src = store.isPending ? undefined : kind === 'phone' ? phoneUrl : kind === 'own' ? ownUrl : cut;
  const own = kind !== 'house';
  const film = useRef(null);
  const fill = useRef(null);

  /* Whether the owner's film is too wide for this screen to fill: read from
     the film itself once it knows its size, and again when the screen turns. */
  const [fit, setFit] = useState(false);
  const measure = () => {
    const el = film.current;
    if (!el || kind !== 'own' || !el.videoWidth || !el.videoHeight) return setFit(false);
    const box = el.parentElement.getBoundingClientRect();
    const film_ = el.videoWidth / el.videoHeight;
    const screen = box.width / Math.max(1, box.height);
    // filling the screen keeps screen/film of the film's width
    setFit(film_ > screen && 1 - screen / film_ > MAX_CROP);
  };
  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [kind, src]);

  /* iOS starts a film on its own only if it is muted as an attribute, not
     just as the property React sets — so say so on the element itself. */
  useEffect(() => {
    for (const el of [film.current, fill.current]) {
      if (!el) continue;
      el.muted = true;
      el.defaultMuted = true;
      el.setAttribute('muted', '');
      if (src) el.play().catch(() => {});
    }
  }, [src, fit]);

  /* The blurred copy follows the film: it plays and stops with it, and is
     drawn back to it if they drift — it is blurred, so near enough is right. */
  useEffect(() => {
    const el = film.current;
    const bg = fill.current;
    if (!el || !bg || !fit) return undefined;
    const play = () => bg.play().catch(() => {});
    const pause = () => bg.pause();
    const sync = () => {
      if (Math.abs(bg.currentTime - el.currentTime) > 0.35) bg.currentTime = el.currentTime;
    };
    el.addEventListener('play', play);
    el.addEventListener('pause', pause);
    el.addEventListener('seeked', sync);
    el.addEventListener('timeupdate', sync);
    return () => {
      el.removeEventListener('play', play);
      el.removeEventListener('pause', pause);
      el.removeEventListener('seeked', sync);
      el.removeEventListener('timeupdate', sync);
    };
  }, [fit, src]);

  /* Low Power Mode refuses every film a page starts on its own, whatever the
     page does. The still is already on screen, and iOS's own play button is
     hidden (styles.css), so nothing looks broken — and the first tap, swipe
     or key anywhere on the page counts as asking, so it plays then. iOS only
     grants that on the end of a touch, not its start, so listen for both,
     and keep listening until a play has actually taken. */
  useEffect(() => {
    const events = ['touchend', 'pointerup', 'click', 'keydown'];
    const stop = () => events.forEach((e) => document.removeEventListener(e, go, true));
    function go() {
      const el = film.current;
      if (!el) return;
      if (!el.paused) return stop();
      fill.current?.play().catch(() => {});
      el.play().then(stop, () => {});
    }
    events.forEach((e) => document.addEventListener(e, go, { capture: true, passive: true }));
    return stop;
  }, []);

  /* Nothing is decoded while the hero is off screen: the rest of the page
     scrolls against a film that has been put down, not one still running.
     But a film put down has to be picked up again — and the observer only
     speaks when the geometry changes, which switching tabs is not. Without
     the second half of this the hero stopped mid-loop and stayed stopped. */
  useEffect(() => {
    const el = film.current;
    if (!el) return;
    let onScreen = true;

    const roll = () => {
      if (onScreen && document.visibilityState === 'visible') el.play().catch(() => {});
    };

    let io;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(
        ([e]) => {
          onScreen = e.isIntersecting;
          if (onScreen) roll();
          else el.pause();
        },
        { threshold: 0.02 },
      );
      io.observe(el);
    }

    // back from another tab, and after anything else stops it
    document.addEventListener('visibilitychange', roll);
    el.addEventListener('pause', roll);
    return () => {
      io?.disconnect();
      document.removeEventListener('visibilitychange', roll);
      el.removeEventListener('pause', roll);
    };
  }, []);

  const broke = () => {
    if (own && src) setFailed((f) => new Set(f).add(src));
  };

  return (
    <section className="hero" id="top">
      {/* the film opens on its own still, so nothing flashes before the
          first frame and nothing goes dark between passes */}
      <div className="hero-poster" aria-hidden="true" />

      <div className="hero-film">
        {/* a film too wide for the screen: a soft, darkened copy fills it */}
        {fit && (
          <video
            className="hero-vid-fill"
            ref={fill}
            src={src}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            aria-hidden="true"
            tabIndex={-1}
          />
        )}
        {/* the house film keeps its own last frame behind it; the owner's film
            has no still of ours, and is framed from its centre */}
        <video
          className={`hero-vid${own ? ' is-own' : ''}${fit ? ' is-fit' : ''}`}
          ref={film}
          src={src}
          poster={own ? undefined : OPENING.end}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden="true"
          style={own ? undefined : { backgroundImage: `url(${OPENING.end})` }}
          onLoadedMetadata={measure}
          onError={broke}
        />
      </div>

      <div className="hero-chrome">
        <div className="hero-top">
          <div className="label">
            Follies d'Après-Midi <span className="hide-s">&nbsp;— Échappée 4 à 7</span>
          </div>
          <div className="label hide-s">Designed &amp; produced in Lebanon</div>
        </div>
      </div>
    </section>
  );
}
