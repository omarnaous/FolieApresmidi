import React from 'react';
import { imageSrc } from '../../shared/api';
import { featuredIn, isColourOption, srcSet } from '../lib/catalog';
import { useMoney, useStore } from '../lib/queries';

const SIZES = {
  rail: '(max-width: 760px) 74vw, (max-width: 1100px) 40vw, 26vw',
  grid: '(max-width: 760px) 50vw, (max-width: 1100px) 33vw, 25vw',
};

/**
 * A piece, the way the house shows one: the plate is a lit studio sweep in
 * stone, so the white-ground packshots sit in it rather than on it, and the
 * category runs up the left edge.
 *
 *   rail      on a boutique rail — a slide among `total`, no price (the home
 *             page leaves that to the product page)
 *   price     under the name, for the catalogue, where pieces are compared
 *   showDrop  from the row or grid: when every piece in view is from the
 *             drop, the label says what the piece is instead of repeating
 *             the drop's name
 */
export default function PieceCard({ product: p, index, total, onOpen, showDrop, rail = false, price = false }) {
  const { data: store } = useStore();
  const money = useMoney();
  const [a, b] = p.images;
  const drop = featuredIn(p, store);
  // the drop when the row mixes, else what the piece is: its type, or the first collection it is in
  const tag = (showDrop && drop ? drop.title : p.productType) || p.collections.find((cl) => cl.handle !== drop?.handle)?.title || '';
  const colour = p.options.find((o) => isColourOption(o.name));
  const colours = colour && colour.values.length > 1 ? colour.values : [];
  // the jewellery is shot on grey, not white
  const grey = p.isAccessory;
  const sizes = rail ? SIZES.rail : SIZES.grid;

  const open = () => onOpen(p);

  return (
    <article
      className={`rc${grey ? ' on-grey' : ''}`}
      style={{ '--i': index }}
      {...(rail && {
        'data-rail-card': true,
        role: 'group',
        'aria-roledescription': 'slide',
        'aria-label': `${index + 1} of ${total}: ${p.title}`,
      })}
    >
      <div className="rc-body">
        <div
          className="rc-plate"
          onClick={open}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
          }}
          role="link"
          tabIndex={0}
          aria-label={`View ${p.title}`}
          data-cursor="View"
        >
          <div className="rc-shot">
            {a && (
              <img
              decoding="async"
                className={`rc-img main ${b ? 'has-alt' : ''}`}
                src={imageSrc(a, 960)}
                srcSet={srcSet(a, [480, 800, 1200])}
                sizes={sizes}
                alt={a.alt || p.title}
                loading={index < 4 ? 'eager' : 'lazy'}
                draggable="false"
              />
            )}
            {b && (
              <img
              decoding="async"
                className="rc-img alt"
                src={imageSrc(b, 960)}
                srcSet={srcSet(b, [480, 800, 1200])}
                sizes={sizes}
                alt=""
                aria-hidden="true"
                loading="lazy"
                draggable="false"
              />
            )}
          </div>

          {tag && <span className="rc-tag" aria-hidden="true">{tag}</span>}
          {!p.available && <span className="rc-flag label">Sold out</span>}
          <span className="rc-view label" aria-hidden="true">View piece</span>
        </div>

        <div className="rc-meta">
          <div className="rc-line">
            <h3 className="rc-name">
              <a
                href={`/products/${p.handle}`}
                onClick={(e) => { e.preventDefault(); open(); }}
                tabIndex={-1}
              >
                {p.title}
              </a>
            </h3>
            {price && (
              <span className="rc-price">
                {money(p.price)}
                {p.compareAtPrice ? <s className="price-was"><span className="sr-only">Was </span>{money(p.compareAtPrice)}</s> : null}
              </span>
            )}
          </div>
          {colours.length > 0 && (
            <div className="rc-colours">
              <span className="rc-dots" aria-hidden="true">
                {colours.map((c) => (
                  <i key={c.value} style={{ background: c.swatch || 'var(--sand)' }} title={c.value} />
                ))}
              </span>
              <span className="label">{colours.length} colours</span>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

/** Stand-ins at the real size while a rail or grid loads, so nothing jumps. */
export function PieceSkeletons({ count = 5 }) {
  return Array.from({ length: count }, (_, i) => (
    <div className="rc is-skel" key={i} style={{ '--i': i }} aria-hidden="true">
      <div className="rc-body">
        <div className="rc-plate skel" />
        <div className="rc-meta">
          <span className="skel skel-line" style={{ width: '64%' }} />
          <span className="skel skel-line" style={{ width: '22%' }} />
        </div>
      </div>
    </div>
  ));
}
