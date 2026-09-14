import React from 'react';
import { FEED, post } from '../data/assets';
import { useCart } from '../store/cart';

const LINKS = [
  ['Boutique', '#boutique'],
  ['Échappée 4 à 7', '#lookbook'],
  ['The house', '#maison'],
  ['Pop-ups', '#popups'],
];

const STRIP = FEED.slice(0, 3);

export default function MobileMenu({ open, onClose, onSearch }) {
  const { count, openCart } = useCart();

  return (
    <div className={`menu ${open ? 'on' : ''}`} aria-hidden={!open}>
      <div className="menu-top">
        <span className="nav-mark">FDM</span>
        <button className="menu-x" onClick={onClose} aria-label="Close menu">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <nav className="menu-links">
        {LINKS.map(([label, href], i) => (
          <a key={href} href={href} onClick={onClose} style={{ transitionDelay: `${160 + i * 55}ms` }}>
            {label}
          </a>
        ))}
        <button
          className="menu-accent"
          style={{ transitionDelay: `${160 + LINKS.length * 55}ms` }}
          onClick={() => { onClose(); onSearch(); }}
        >
          All pieces
        </button>
        <button
          style={{ transitionDelay: `${160 + (LINKS.length + 1) * 55}ms` }}
          onClick={() => { onClose(); openCart(); }}
        >
          Bag {count > 0 && <sup className="menu-count">{count}</sup>}
        </button>
      </nav>

      <div className="menu-strip">
        {STRIP.map((f) => (
          <a key={f.code} href={post(f.code)} target="_blank" rel="noreferrer noopener" aria-label={f.label}>
            <img src={f.src} alt={f.label} loading="lazy" />
          </a>
        ))}
      </div>

      <div className="menu-foot">
        <a className="label link-u" href="mailto:folliesdapresmidi@gmail.com">folliesdapresmidi@gmail.com</a>
        <a
          className="label link-u"
          href="https://instagram.com/folliesdapresmidi"
          target="_blank"
          rel="noreferrer noopener"
        >
          @folliesdapresmidi ↗
        </a>
      </div>
    </div>
  );
}
