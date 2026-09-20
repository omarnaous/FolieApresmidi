import React, { useEffect, useRef } from 'react';
import Reveal from './Reveal';
import { imageSrc } from '../../shared/api';
import Notebook from './Notebook';
import { useEyebrow } from '../data/sections';
import { emphasis } from '../lib/emphasis';
import { srcSet } from '../lib/catalog';
import { useProductList, useStore } from '../lib/queries';

const shot = (p, sizes) =>
  p.images[0] ? (
    <img
              decoding="async"
      src={imageSrc(p.images[0], 960)}
      srcSet={srcSet(p.images[0], [640, 960, 1400])}
      sizes={sizes}
      alt={p.images[0].alt || p.title}
      loading="lazy"
    />
  ) : null;

export default function Editorial({ onOpen }) {
  const eyebrow = useEyebrow('#journal');
  const { data: store } = useStore();
  const copy = store?.home?.journal;
  const handle = store?.editorialCollectionHandle;
  const { data } = useProductList(
    { collection: handle ?? undefined, sort: 'featured', limit: 3 },
    { enabled: !!handle },
  );
  const [hero, a, b] = handle ? data?.items ?? [] : [];

  /* The plates under the look book are uncovered by the scroll itself: the
     photograph is drawn down as the plate rises into place, so coming off
     the look book and onto them is one movement instead of a block landing
     on the page. Each plate is told how far it has travelled and the
     stylesheet does the rest — written straight to a CSS variable, the way
     the hero rides the lift, so scrolling never re-renders React.

     It opens once. `--u` is allowed to rise and never to fall, so scrolling
     back up leaves the plates uncovered instead of drawing the curtain
     again; when both are fully open the handler takes itself off. */
  const more = useRef(null);
  useEffect(() => {
    const els = [...(more.current?.children ?? [])];
    if (!els.length || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    let done = false;
    const update = () => {
      raf = 0;
      const h = window.innerHeight;
      let all = true;
      for (const el of els) {
        const was = Number(el.dataset.u || 0);
        if (was >= 1) continue;
        // 0 as the plate clears the bottom edge, 1 by the time it is a third of the way up
        const u = (h - 140 - el.getBoundingClientRect().top) / (h * 0.62);
        const now = Math.min(1, Math.max(0, u));
        if (now > was) {
          el.dataset.u = String(now);
          el.style.setProperty('--u', now.toFixed(4));
        }
        // the handler is here, so the stylesheet may take the reveal over
        el.dataset.unveil = '';
        if (Number(el.dataset.u || 0) < 1) all = false;
      }
      if (all && !done) { done = true; stop(); }
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    const stop = () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return stop;
  }, [a?.id, b?.id]);

  // the section is built around a piece; without one it waits rather than showing a hole
  if (!hero) return null;

  return (
    <section className="section shell tight-top" id="journal">
      <div className="edito">
        <Reveal
          variant="rv-mask"
          className="rv-img plate packshot"
          data-cursor="View"
          role="button"
          tabIndex={0}
          aria-label={hero.title}
          onClick={() => onOpen(hero)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(hero); }
          }}
        >
          {shot(hero, '(max-width: 860px) 100vw, 50vw')}
        </Reveal>

        <div className="edito-txt">
          <Reveal><div className="label muted">{eyebrow}</div></Reveal>
          <Reveal delay={90}>
            <h2 className="display d-md">{copy ? emphasis(copy.heading) : '\u00a0'}</h2>
          </Reveal>
          <Reveal delay={160}>
            <p className="lede">{copy?.intro}</p>
          </Reveal>
          <Reveal delay={230}>
            <div className="label muted">
              {hero.title}{hero.productType ? ` · ${hero.productType}` : ''}
            </div>
          </Reveal>
          <Reveal delay={280}>
            <div className="edito-acts">
              <a className="btn" href="#popups" data-cursor="Visit">{copy?.buttonLabel || 'Where to find us'}</a>
              {copy?.notebook && <Notebook file={copy.notebook} />}
            </div>
          </Reveal>
        </div>
      </div>

      <div className="stack edito-more" ref={more}>
        {[a, b].filter(Boolean).map((p, i) => (
          <Reveal
            key={p.id}
            variant="rv-mask"
            delay={i * 180}
            className={`rv-img plate packshot ${i === 0 ? 'a' : 'b'}`}
            data-cursor="View"
            role="button"
            tabIndex={0}
            aria-label={p.title}
            onClick={() => onOpen(p)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(p); }
            }}
          >
            {shot(p, i === 0 ? '(max-width: 760px) 75vw, 58vw' : '(max-width: 760px) 50vw, 33vw')}
          </Reveal>
        ))}
      </div>
    </section>
  );
}
