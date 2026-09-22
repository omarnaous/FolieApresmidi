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

export default function Hero() {
  // the film the owner uploaded, if any; otherwise the built-in campaign cut
  const uploaded = useStore().data?.home?.hero?.video?.url ?? null;
  const [cut] = useState(pickCut);
  const film = useRef(null);

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

  return (
    <section className="hero" id="top">
      {/* the film opens on its own still, so nothing flashes before the
          first frame and nothing goes dark between passes */}
      <div className="hero-poster" aria-hidden="true" />

      <div className="hero-film">
        <video
          className="hero-vid"
          ref={film}
          src={uploaded || cut}
          poster={OPENING.end}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden="true"
          style={{ backgroundImage: `url(${OPENING.end})` }}
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
