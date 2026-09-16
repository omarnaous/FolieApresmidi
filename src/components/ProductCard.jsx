import React from 'react';
import Reveal from './Reveal';
import { imageSrc } from '../../shared/api';
import { featuredIn, productSubtitle, srcSet } from '../lib/catalog';
import { useMoney, useStore } from '../lib/queries';

const SIZES = '(max-width: 760px) 50vw, (max-width: 1100px) 33vw, 25vw';

/**
 * `showDrop` comes from the grid, not the product: the catalogue sorts the
 * drop to the front, so a badge on every visible card marks nothing. The
 * grid only sets it when the pieces on screen are actually a mix.
 */
export default function ProductCard({ product, index, onOpen, showDrop = true }) {
  const money = useMoney();
  const { data: store } = useStore();
  const [a, b] = product.images;
  const hasAlt = !!b;
  const drop = featuredIn(product, store);
  const sub = productSubtitle(product);

  return (
    <Reveal variant="rv" className="card" delay={(index % 4) * 80}>
      <div
        className="plate packshot card-plate"
        onClick={() => onOpen(product)}
        data-cursor="View"
        role="button"
        tabIndex={0}
        aria-label={product.title}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(product); }
        }}
      >
        {a && (
          <img
            className={`main ${hasAlt ? 'has-alt' : ''}`}
            src={imageSrc(a, 640)}
            srcSet={srcSet(a)}
            sizes={SIZES}
            alt={a.alt || product.title}
            loading={index < 4 ? 'eager' : 'lazy'}
          />
        )}
        {hasAlt && (
          <img className="alt" src={imageSrc(b, 640)} srcSet={srcSet(b)} sizes={SIZES} alt="" aria-hidden="true" loading="lazy" />
        )}

        {drop && showDrop && <span className="card-tag label hot">{drop.title}</span>}
        {!product.available && <span className="card-tag label" style={{ left: 'auto', right: 12 }}>Sold out</span>}

        <button className="card-quick" onClick={(e) => { e.stopPropagation(); onOpen(product); }}>
          View piece
        </button>
      </div>

      <div className="card-meta">
        <div>
          <div className="card-name">{product.title}</div>
          {sub && <div className="card-sub label muted">{sub}</div>}
        </div>
        <div className="card-price">
          {money(product.price)}
          {product.compareAtPrice ? (
            <s className="price-was"><span className="sr-only">Was </span>{money(product.compareAtPrice)}</s>
          ) : null}
        </div>
      </div>
    </Reveal>
  );
}
