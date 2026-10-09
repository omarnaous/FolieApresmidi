import React, { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { imageSrc } from '../../shared/api';
import { srcSet } from '../lib/catalog';
import { emphasis } from '../lib/emphasis';
import { useEyebrow } from '../data/sections';
import { useStore } from '../lib/queries';
import { useRail } from '../hooks/useRail';
import { useInView } from '../hooks/useInView';
import { LOOKBOOK } from '../data/lookbook';

const SIZES = '(max-width: 760px) 74vw, (max-width: 1100px) 40vw, 26vw';
/** The home page shows a taste, as the boutique shelf does; the full set opens behind the button. */
const RAIL_MAX = 12;

/**
 * The lookbook images, the owner's own or — until any are set in the admin —
 * the house's seed photographs. Both are shaped as media, so the rail and the
 * full view can read them the same way.
 */
export function useLooks() {
  const { data: store } = useStore();
  const images = store?.home?.lookbook?.images;
  if (images && images.length) return images;
  return LOOKBOOK.map((url, i) => ({ id: `seed-${i}`, url, alt: '', width: null, height: null }));
}

const pad = (n) => String(n).padStart(2, '0');

const Arrow = ({ flip }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
    <path d="m9 5 7 7-7 7" />
  </svg>
);

/**
 * The look book on the home page: the house's photographs on the same
 * sideways rail the boutique uses — graded like the rest of the site's
 * plates, no piece and no price. The whole row, and the button under it,
 * open the full look book.
 */
export default function Lookbook() {
  const eyebrow = useEyebrow('#lookbook');
  const navigate = useNavigate();
  const { data: store } = useStore();
  const copy = store?.home?.lookbook;
  const looks = useLooks().slice(0, RAIL_MAX);

  const openAll = () => navigate('/lookbook');

  const rail = useRail();
  const { measure } = rail;
  const [stage, onStage] = useInView({ threshold: 0.12 });
  useEffect(() => { measure(); }, [looks.length, measure]);

  if (!looks.length) return null;

  const count = rail.count || looks.length;
  const state = onStage ? 'dealt' : 'ready';

  return (
    <section className="section shell has-shelf" id="lookbook">
      <div className="sec-head">
        <div>
          <div className="label muted" style={{ marginBottom: 14 }}>{eyebrow}</div>
          <h2 className="display d-md">{copy?.heading ? emphasis(copy.heading) : 'The lookbook'}</h2>
          {copy?.intro && <p className="sec-sub">{copy.intro}</p>}
        </div>
      </div>

      <div
        className="shelf"
        ref={stage}
        data-state={state}
        role="region"
        aria-roledescription="carousel"
        aria-label="The lookbook"
      >
        <div
          className="shelf-track"
          {...rail.bind}
          id="lookbook-rail"
          tabIndex={-1}
          data-lenis-prevent-horizontal
        >
          <div className="shelf-row">
            {looks.map((m, i) => (
              <article
                key={m.id}
                className="rc rc--look"
                data-rail-card
                style={{ '--i': i }}
                role="group"
                aria-roledescription="slide"
                aria-label={`Look ${i + 1} of ${looks.length}`}
              >
                <div className="rc-body">
                  <div
                    className="rc-plate"
                    onClick={openAll}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAll(); }
                    }}
                    role="link"
                    tabIndex={0}
                    aria-label="Open the look book"
                    data-cursor="Look"
                  >
                    <div className="rc-shot">
                      <img
                        className="rc-img"
                        decoding="async"
                        src={imageSrc(m, 960)}
                        srcSet={srcSet(m, [480, 800, 1200])}
                        sizes={SIZES}
                        alt={m.alt || `Follies d'Après-Midi — look ${i + 1}`}
                        loading={i < 4 ? 'eager' : 'lazy'}
                        draggable="false"
                      />
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>

        <button
          type="button"
          className="shelf-arrow prev"
          onClick={rail.prev}
          aria-controls="lookbook-rail"
          aria-label="Previous looks"
          disabled={rail.atStart}
          data-cursor="Back"
        >
          <Arrow flip />
        </button>
        <button
          type="button"
          className="shelf-arrow next"
          onClick={rail.next}
          aria-controls="lookbook-rail"
          aria-label="More looks"
          disabled={rail.atEnd}
          data-cursor="More"
        >
          <Arrow />
        </button>
      </div>

      <div className="shelf-foot">
        <div className="shelf-count" aria-hidden="true">
          <span className="shelf-now"><b key={rail.index}>{pad(Math.min(rail.index + 1, count))}</b></span>
          <span className="shelf-of">/ {pad(count)}</span>
        </div>
        <div
          className="shelf-bar"
          role="presentation"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            rail.goTo(Math.round(((e.clientX - r.left) / r.width) * (count - 1)));
          }}
        >
          <i
            style={{
              width: `${Math.max(8, rail.window * 100)}%`,
              left: `${rail.progress * (100 - Math.max(8, rail.window * 100))}%`,
            }}
          />
        </div>
        <button className="btn shelf-all" onClick={openAll} data-cursor="Look">
          View the look book <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
}
