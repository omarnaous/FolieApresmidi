import React from 'react';
import { Link } from 'react-router';
import { FEED, post } from '../data/assets';
import { useCart } from '../store/cart';
import { SECTIONS } from '../data/sections';
import { useStore } from '../lib/queries';
import { instagramHandle } from '../lib/store';

const LINKS = SECTIONS.map((s) => [s.label, s.href]);

const STRIP = FEED.slice(0, 3);

export default function MobileMenu({ open, onClose, onAll }) {
  const { count, openCart } = useCart();
  const { data: store } = useStore();
  const ig = instagramHandle(store?.contact.instagram);
  const email = store?.contact.email;

  return (
    // data-lenis-prevent: same reason as the other overlays -- Lenis is stopped
    // while this is open and would preventDefault the menu's own touchmoves.
    <div className={`menu ${open ? 'on' : ''}`} aria-hidden={!open} data-lenis-prevent>
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
          onClick={() => { onClose(); onAll(); }}
        >
          All pieces
        </button>
        <button
          style={{ transitionDelay: `${160 + (LINKS.length + 1) * 55}ms` }}
          onClick={() => { onClose(); openCart(); }}
        >
          Bag {count > 0 && <sup className="menu-count">{count}</sup>}
        </button>
        <Link
          to="/account"
          onClick={onClose}
          style={{ transitionDelay: `${160 + (LINKS.length + 2) * 55}ms` }}
        >
          Account
        </Link>
      </nav>

      <div className="menu-strip">
        {STRIP.map((f) => (
          <a key={f.code} href={post(f.code)} target="_blank" rel="noreferrer noopener" aria-label={f.label}>
            <img src={f.src} alt={f.label} loading="lazy" />
          </a>
        ))}
      </div>

      <div className="menu-foot">
        {email && <a className="label link-u" href={`mailto:${email}`}>{email}</a>}
        {ig && (
          <a
            className="label link-u"
            href={`https://instagram.com/${ig}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            @{ig} ↗
          </a>
        )}
      </div>
    </div>
  );
}
