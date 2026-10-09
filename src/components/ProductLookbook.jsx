import React from 'react';
import { imageSrc } from '../../shared/api';
import { srcSet } from '../lib/catalog';
import { useInView } from '../hooks/useInView';

const pad = (n) => String(n).padStart(2, '0');

/**
 * The look-book photographs the owner paired with this piece, at the foot of
 * its page: the garment worn, in the house's own pictures. Same shape as
 * "Shop the look" above it, but editorial plates — graded, not packshots.
 */
export default function ProductLookbook({ product, urls }) {
  const [ref, seen] = useInView({ threshold: 0.12 });

  return (
    <section className="pdp-look pdp-lookbook" ref={ref} data-seen={seen || undefined} aria-labelledby="pdp-lookbook-title">
      <div className="pdp-look-head">
        <div>
          <span className="label muted">In the look book</span>
          <h2 className="display d-sm" id="pdp-lookbook-title">
            <i className="italic">{product.title}</i>, worn
          </h2>
        </div>
        <span className="label muted">
          {pad(urls.length)} {urls.length === 1 ? 'look' : 'looks'}
        </span>
      </div>
      <ol className="pdp-look-grid">
        {urls.map((url, i) => {
          const m = { url };
          return (
            <li key={url} className="look-piece" style={{ '--i': i }}>
              <div className="look-plate plate">
                <img
                  decoding="async"
                  src={imageSrc(m, 640)}
                  srcSet={srcSet(m, [320, 640, 960])}
                  sizes="(max-width: 900px) 50vw, 25vw"
                  alt={`${product.title} — look ${i + 1}`}
                  loading="lazy"
                  draggable="false"
                />
                <span className="look-n label">{pad(i + 1)}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
