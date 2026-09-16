import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useCart } from '../store/cart';
import { SECTIONS } from '../data/sections';

export default function Nav({ onMenu, menuOpen, onSearch }) {
  const { count, openCart } = useCart();
  const [solid, setSolid] = useState(false);
  const [hide, setHide] = useState(false);

  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const h = window.innerHeight;
      setSolid(y > h * 0.9);
      setHide(y > h * 1.2 && y > last && y - last > 4);
      last = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`nav ${solid ? 'solid' : ''} ${hide && !menuOpen ? 'hide' : ''}`}>
      <a className="nav-mark" href="#top" aria-label="Follies d'Après Midi — home">
        FDM
      </a>

      <nav className="nav-links" aria-label="Primary">
        {SECTIONS.map((s) => (
          <a key={s.href} className="label link-u" href={s.href}>{s.short}</a>
        ))}
      </nav>

      <div className="nav-right">
        <button className="label link-u" onClick={onSearch} aria-label="Search all pieces">
          Search
        </button>
        <Link className="label link-u nav-account" to="/account">
          Account
        </Link>
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
