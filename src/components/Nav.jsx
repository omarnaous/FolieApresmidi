import React, { useEffect, useState } from 'react';
import { useCart } from '../store/cart';
import { useSections } from '../data/sections';

/**
 * The bar stays on screen everywhere — over the home page as it scrolls, and
 * above every page opened on top of it (`page`), where it is always solid.
 */
export default function Nav({ onMenu, menuOpen, onSearch, page }) {
  const { count, openCart } = useCart();
  const sections = useSections();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > window.innerHeight * 0.9);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`nav ${scrolled || page ? 'solid' : ''}`}>
      <a className="nav-mark" href="#top" aria-label="Follies d'Après Midi — home">
        FDM
      </a>

      <nav className="nav-links" aria-label="Primary">
        {sections.map((s) => (
          <a key={s.href} className="label link-u" href={s.href}>{s.short}</a>
        ))}
      </nav>

      <div className="nav-right">
        <button className="label link-u" onClick={onSearch} aria-label="Search all pieces">
          Search
        </button>
        <button className="label link-u" onClick={openCart} aria-label="Open bag">
          <span className="nav-cart">
            Bag
            {count > 0 && <span className="nav-count">{count}</span>}
          </span>
        </button>
        <button className="label link-u nav-burger" onClick={onMenu} aria-expanded={menuOpen}>
          {menuOpen ? 'Close' : 'Menu'}
        </button>
      </div>
    </header>
  );
}
