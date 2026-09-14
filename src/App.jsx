import React, { useCallback, useEffect, useRef, useState } from 'react';
import Lenis from 'lenis';

import Preloader from './components/Preloader';
import Cursor from './components/Cursor';
import Nav from './components/Nav';
import MobileMenu from './components/MobileMenu';
import Hero from './components/Hero';
import Marquee from './components/Marquee';
import Feed from './components/Feed';
import Shop from './components/Shop';
import Catalogue from './components/Catalogue';
import Editorial from './components/Editorial';
import Lookbook from './components/Lookbook';
import PopUps from './components/PopUps';
import Newsletter from './components/Newsletter';
import Footer from './components/Footer';
import CartDrawer from './components/CartDrawer';
import QuickView from './components/QuickView';
import { useCart } from './store/cart';

export default function App() {
  const [ready, setReady] = useState(false);
  const [menu, setMenu] = useState(false);
  const [quick, setQuick] = useState(null);
  const [catalogue, setCatalogue] = useState({ open: false, category: 'All' });
  const { open: cartOpen, closeCart, toast } = useCart();
  const lenis = useRef(null);

  /* Inertia scroll — the single biggest tell of a considered site. */
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const l = new Lenis({
      duration: 1.15,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      touchMultiplier: 1.6,
    });
    lenis.current = l;

    let raf;
    const loop = (time) => { l.raf(time); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);

    const onAnchor = (e) => {
      const a = e.target.closest?.('a[href^="#"]');
      if (!a) return;
      const id = a.getAttribute('href');
      if (id.length < 2) return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      l.scrollTo(target, { offset: -70, duration: 1.4 });
    };
    document.addEventListener('click', onAnchor);

    return () => { cancelAnimationFrame(raf); document.removeEventListener('click', onAnchor); l.destroy(); };
  }, []);

  /* One place decides whether the page may scroll. */
  const locked = !ready || menu || cartOpen || !!quick || catalogue.open;
  useEffect(() => {
    document.body.classList.toggle('is-locked', locked);
    if (lenis.current) locked ? lenis.current.stop() : lenis.current.start();
  }, [locked]);

  const closeAll = useCallback(() => { closeCart(); setQuick(null); }, [closeCart]);

  return (
    <>
      <Preloader onDone={() => setReady(true)} />
      <Cursor />

      <Nav
        onMenu={() => setMenu((m) => !m)}
        menuOpen={menu}
        onSearch={() => setCatalogue({ open: true, category: 'All' })}
      />
      <MobileMenu
        open={menu}
        onClose={() => setMenu(false)}
        onSearch={() => setCatalogue({ open: true, category: 'All' })}
      />

      <main>
        <Hero ready={ready} />
        <Marquee />
        <Feed />
        <Shop onOpen={setQuick} onAll={(category) => setCatalogue({ open: true, category })} />
        <Editorial onOpen={setQuick} />
        <Lookbook onOpen={setQuick} />
        <PopUps />
        <Newsletter />
      </main>

      <Footer />

      <div className={`scrim ${cartOpen || quick ? 'on' : ''}`} onClick={closeAll} />
      <Catalogue
        open={catalogue.open}
        initialCategory={catalogue.category}
        onClose={() => setCatalogue((c) => ({ ...c, open: false }))}
        onOpen={setQuick}
      />
      <CartDrawer />
      <QuickView product={quick} onClose={() => setQuick(null)} />

      <div className={`toast ${toast ? 'on' : ''}`} role="status" aria-live="polite">
        <span className="label">{toast || ''}</span>
      </div>
    </>
  );
}
