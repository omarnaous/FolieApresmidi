import React from 'react';
import Reveal from './Reveal';
import { money } from '../store/cart';

export default function ProductCard({ product, index, onOpen }) {
  const [a, b] = product.images;
  const hasAlt = !!b;
  const sub = product.colours.length === 1
    ? `${product.line} · ${product.colours[0]}`
    : product.line;

  return (
    <Reveal variant="rv" className="card" delay={(index % 4) * 80}>
      <div
        className="plate packshot card-plate"
        onClick={() => onOpen(product)}
        data-cursor="View"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(product); }
        }}
      >
        <img
          className={`main ${hasAlt ? 'has-alt' : ''}`}
          src={a}
          alt={product.name}
          loading={index < 4 ? 'eager' : 'lazy'}
        />
        {hasAlt && <img className="alt" src={b} alt="" aria-hidden="true" loading="lazy" />}

        {product.drop && <span className="card-tag label hot">Échappée</span>}
        {!product.available && <span className="card-tag label" style={{ left: 'auto', right: 12 }}>Sold out</span>}

        <button className="card-quick" onClick={(e) => { e.stopPropagation(); onOpen(product); }}>
          Quick view
        </button>
      </div>

      <div className="card-meta">
        <div>
          <div className="card-name">{product.name}</div>
          <div className="card-sub label muted">{sub}</div>
        </div>
        <div className="card-price">{money(product.price)}</div>
      </div>
    </Reveal>
  );
}
