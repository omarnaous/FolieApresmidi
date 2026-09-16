import React from 'react';
import Reveal from './Reveal';
import { imageSrc } from '../../shared/api';
import { eyebrow } from '../data/sections';
import { srcSet } from '../lib/catalog';
import { useMoney, useProductList, useStore } from '../lib/queries';

const shot = (p, sizes) =>
  p.images[0] ? (
    <img
      src={imageSrc(p.images[0], 960)}
      srcSet={srcSet(p.images[0], [640, 960, 1400])}
      sizes={sizes}
      alt={p.images[0].alt || p.title}
      loading="lazy"
    />
  ) : null;

export default function Editorial({ onOpen }) {
  const money = useMoney();
  const { data: store } = useStore();
  const handle = store?.editorialCollectionHandle;
  const { data } = useProductList(
    { collection: handle ?? undefined, sort: 'featured', limit: 3 },
    { enabled: !!handle },
  );
  const [hero, a, b] = handle ? data?.items ?? [] : [];

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
          <Reveal><div className="label muted">{eyebrow('#journal')}</div></Reveal>
          <Reveal delay={90}>
            <h2 className="display d-md">
              Limited quantities.<br />
              <i className="italic">Made in Lebanon.</i>
            </h2>
          </Reveal>
          <Reveal delay={160}>
            <p className="lede">
              Pieces for women who dress with confidence, attitude and instinct — who value
              exclusivity, comfort and craftsmanship, and clothes that feel alive. FDM is not only
              about what you wear, but the mood you step into.
            </p>
          </Reveal>
          <Reveal delay={230}>
            <div className="label muted">
              {hero.title} — {money(hero.price)}{hero.productType ? ` · ${hero.productType}` : ''}
            </div>
          </Reveal>
          <Reveal delay={280}>
            <a className="btn" href="#popups" data-cursor="Visit">Where to find us</a>
          </Reveal>
        </div>
      </div>

      <div className="stack" style={{ paddingTop: 'clamp(50px, 8vw, 120px)' }}>
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
