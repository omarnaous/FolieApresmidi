import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useCart } from '../store/cart';
import { useSections } from '../data/sections';
import { useStore } from '../lib/queries';

/* Thin, quiet line icons — the house's own weight, drawn to sit either side
   of the mark without shouting. */
const IconMenu = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M3.5 7h17M3.5 12h17M3.5 17h17" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);
const IconClose = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);
const IconSearch = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.3" />
    <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);
const IconBag = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6 8.5h12l-.9 11.1a1 1 0 0 1-1 .9H7.9a1 1 0 0 1-1-.9L6 8.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

/**
 * The bar stays on screen everywhere — over the home page as it scrolls, and
 * above every page opened on top of it (`page`), where it is always solid.
 *
 * The mark sits dead centre. On a desk the sections are spelled out either
 * side as links; on a phone they fold into the menu the burger opens. Over
 * the film the bar is transparent and set in bone; once past the film it
 * turns the house orange.
 */
export default function Nav({ onMenu, menuOpen, onSearch, page }) {
  const { count, openCart } = useCart();
  const sections = useSections();
  const navigate = useNavigate();
  const { data: store } = useStore();
  const [scrolled, setScrolled] = useState(false);

  // the collections, in the owner's saved order — shown in the Boutique pop-up
  const collections = (store?.menu ?? []).filter((m) => m.collectionHandle);
  const toCollection = (handle) => (e) => { e.preventDefault(); navigate(`/collections/${handle}`); };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > window.innerHeight * 0.9);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`nav ${scrolled || page ? 'solid' : ''}`}>
      <div className="nav-left">
        {/* phone: the sections fold into a drawer */}
        <button className="nav-ico nav-burger" onClick={onMenu} aria-expanded={menuOpen} aria-label={menuOpen ? 'Close menu' : 'Open menu'}>
          {menuOpen ? <IconClose /> : <IconMenu />}
        </button>
        {/* desk: the sections, spelled out */}
        <nav className="nav-links" aria-label="Primary">
          {sections.map((s) =>
            s.key === 'boutique' && collections.length ? (
              // the boutique opens a pop-up of the collections, in the saved order
              <span key={s.href} className="nav-drop">
                <a className="label link-u" href={s.href} aria-haspopup="true">{s.short}</a>
                <span className="nav-drop-panel" role="menu" aria-label="Collections">
                  <a className="nav-drop-item" href="/collections/all" onClick={toCollection('all')} role="menuitem">All pieces</a>
                  {collections.map((c) => (
                    <a
                      key={c.collectionHandle}
                      className="nav-drop-item"
                      href={`/collections/${c.collectionHandle}`}
                      onClick={toCollection(c.collectionHandle)}
                      role="menuitem"
                    >
                      {c.label}
                    </a>
                  ))}
                </span>
              </span>
            ) : (
              <a key={s.href} className="label link-u" href={s.href}>{s.short}</a>
            ),
          )}
        </nav>
        {/* phone: search sits by the menu */}
        <button className="nav-ico nav-search-m" onClick={onSearch} aria-label="Search all pieces">
          <IconSearch />
        </button>
      </div>

      <a className="nav-mark" href="#top" aria-label="Follies d'Après-Midi — home">
        <img src="/brand/wordmark.png" alt="Follies d'Après-Midi" className="nav-logo" width="1194" height="385" />
      </a>

      <div className="nav-right">
        {/* desk: search sits by the bag */}
        <button className="nav-ico nav-search-d" onClick={onSearch} aria-label="Search all pieces">
          <IconSearch />
        </button>
        <button className="nav-ico nav-bag" onClick={openCart} aria-label="Open bag">
          <IconBag />
          {count > 0 && <span className="nav-count">{count}</span>}
        </button>
      </div>
    </header>
  );
}
