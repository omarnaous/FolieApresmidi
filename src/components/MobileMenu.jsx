import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { FEED, post } from '../data/assets';
import { useCart } from '../store/cart';
import { useSections } from '../data/sections';
import { useStore } from '../lib/queries';
import { instagramHandle } from '../lib/store';

const STRIP = FEED.slice(0, 3);

export default function MobileMenu({ open, onClose, onAll }) {
  const { count, openCart } = useCart();
  const sections = useSections();
  const LINKS = sections.map((s) => [s.label, s.href, s.key]);
  const { data: store } = useStore();
  const navigate = useNavigate();

  /* The Boutique opens a page of its own inside the menu: the collections
     with their season lines, then the subcollections, then everything. */
  const [boutique, setBoutique] = useState(false);
  useEffect(() => {
    if (!open) setBoutique(false);
  }, [open]);
  const collections = (store?.menu ?? []).filter((m) => m.collectionHandle);
  const categories = store?.categories ?? [];
  const boutiqueLabel = sections.find((s) => s.key === 'boutique')?.label ?? 'Boutique';
  const to = (path) => (e) => {
    e.preventDefault();
    onClose();
    navigate(path);
  };
  const ig = instagramHandle(store?.contact.instagram);
  const email = store?.contact.email;

  return (
    // data-lenis-prevent: same reason as the other overlays -- Lenis is stopped
    // while this is open and would preventDefault the menu's own touchmoves.
    <div className={`menu ${open ? 'on' : ''} ${boutique ? 'is-sub' : ''}`} aria-hidden={!open} data-lenis-prevent>
      <div className="menu-top">
        <span className="nav-mark">FDM</span>
        <button className="menu-x" onClick={onClose} aria-label="Close menu">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {boutique && (
        <nav className="menu-sub" aria-label={boutiqueLabel}>
          <button type="button" className="menu-sub-back" onClick={() => setBoutique(false)}>
            <span aria-hidden="true">‹</span> {boutiqueLabel}
          </button>
          <div className="menu-sub-cols">
            {collections.map((c) => (
              <a key={c.collectionHandle} href={`/collections/${c.collectionHandle}`} onClick={to(`/collections/${c.collectionHandle}`)}>
                <span className="menu-sub-name">{c.label}</span>
                {c.subtitle && <span className="menu-sub-season">{c.subtitle}</span>}
              </a>
            ))}
          </div>
          {categories.length > 0 && (
            <div className="menu-sub-cats">
              {categories.map((name) => {
                const path = `/collections/all?type=${encodeURIComponent(name)}`;
                return (
                  <a key={name} href={path} onClick={to(path)}>{name}</a>
                );
              })}
            </div>
          )}
          <a className="menu-sub-all" href="/collections/all" onClick={to('/collections/all')}>View all</a>
        </nav>
      )}

      <nav className="menu-links" hidden={boutique}>
        {LINKS.map(([label, href, key], i) =>
          key === 'boutique' && collections.length ? (
            <button
              key={href}
              type="button"
              className="menu-has-sub"
              aria-expanded={boutique}
              onClick={() => setBoutique(true)}
              style={{ transitionDelay: `${160 + i * 55}ms` }}
            >
              {label} <span className="menu-arrow" aria-hidden="true">›</span>
            </button>
          ) : (
            <a key={href} href={href} onClick={onClose} style={{ transitionDelay: `${160 + i * 55}ms` }}>
              {label}
            </a>
          ),
        )}
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
      </nav>

      <div className="menu-strip">
        {STRIP.map((f) => (
          <a key={f.code} href={post(f.code)} target="_blank" rel="noreferrer noopener" aria-label={f.label}>
            <img
              decoding="async" src={f.src} alt={f.label} loading="lazy" />
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
