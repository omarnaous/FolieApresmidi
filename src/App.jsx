import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import Lenis from 'lenis';

import Preloader from './components/Preloader';
import Cursor from './components/Cursor';
import Nav from './components/Nav';
import MobileMenu from './components/MobileMenu';
import Hero from './components/Hero';
import Maison from './components/Maison';
import Shop from './components/Shop';
import Accessories from './components/Accessories';
import Catalogue from './components/Catalogue';
import Editorial from './components/Editorial';
import PopUps from './components/PopUps';
import Newsletter from './components/Newsletter';
import Footer from './components/Footer';
import CartDrawer from './components/CartDrawer';
import Checkout from './components/Checkout';
import ProductPage from './components/ProductPage';
import OrderSheet from './checkout/OrderSheet';
import PageSheet from './content/PageSheet';
import { useSections } from './data/sections';
import { useCart } from './store/cart';
import { parseRoute, sheetState, useCloseOverlay, useSheetNavigate } from './lib/routes';

/** Which component each section key draws, so page order follows the saved order. */
const SECTION_VIEWS = {
  maison: ({ openCatalogue }) => <Maison onOpen={openCatalogue} />,
  boutique: ({ openProduct, openCatalogue }) => <Shop onOpen={openProduct} onAll={openCatalogue} />,
  accessories: ({ openProduct, openCatalogue }) => <Accessories onOpen={openProduct} onAll={openCatalogue} />,
  journal: ({ openProduct }) => <Editorial onOpen={openProduct} />,
  popups: () => <PopUps />,
};

export default function App() {
  const [ready, setReady] = useState(false);
  const [menu, setMenu] = useState(false);
  const { open: bagOpen, closeCart, toast } = useCart();
  const location = useLocation();
  const navigate = useNavigate();
  const closeOverlay = useCloseOverlay();
  // the sections the owner has switched on, in their order
  const sections = useSections();
  const sheetNavigate = useSheetNavigate();
  const lenis = useRef(null);

  /* The URL says which overlay is up; the home page is always underneath. */
  const route = useMemo(() => parseRoute(location.pathname), [location.pathname]);
  const here = location.pathname + location.search;
  // the catalogue on its own route, or still open beneath a piece opened from it
  const catalogue =
    route.kind === 'catalogue' ? here
      : route.kind === 'product' ? sheetState(location.state).catalogue ?? null
        : null;
  const cartOpen = bagOpen || route.kind === 'cart';

  /* Inertia scroll — the single biggest tell of a considered site. */
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    /* A finger on glass is already smooth: iOS and Android hand momentum
       scrolling to the compositor, off the main thread, and nothing written
       in JavaScript can match it. Taking it over only adds a frame of lag and
       a loop that never sleeps. Lenis is for a mouse wheel, which has no
       momentum of its own — so a touch device keeps its own scrolling, and
       `glide` falls back to scrollIntoView for the anchors. */
    if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) return;

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

    return () => { cancelAnimationFrame(raf); l.destroy(); lenis.current = null; };
  }, []);

  const home = route.kind === 'home';
  // the section's scroll-margin keeps it clear of the bar; Lenis reads it too
  const glide = useCallback((target) => {
    if (lenis.current) lenis.current.scrollTo(target, { duration: 1.4 });
    else target.scrollIntoView();
  }, []);

  /* A link to a section of the home page. From the home page it glides there.
     From a page on top, or from the open menu, the home page cannot scroll
     yet (a stopped Lenis ignores scrollTo), so the page closes first and the
     glide waits until the home page is free. */
  const pending = useRef(null);
  useEffect(() => {
    const onAnchor = (e) => {
      const id = e.target.closest?.('a[href^="#"]')?.getAttribute('href');
      const target = id && id.length > 1 ? document.getElementById(id.slice(1)) : null;
      if (!target?.closest('main, footer')) return;
      e.preventDefault();
      if (!home) navigate('/');
      if (!home || document.body.classList.contains('is-locked')) pending.current = target;
      else glide(target);
    };
    document.addEventListener('click', onAnchor);
    return () => document.removeEventListener('click', onAnchor);
  }, [home, navigate, glide]);

  /* One place decides whether the page may scroll. */
  const locked = !ready || menu || cartOpen || !home;
  useEffect(() => {
    document.body.classList.toggle('is-locked', locked);
    if (lenis.current) locked ? lenis.current.stop() : lenis.current.start();
    if (!locked && pending.current) {
      glide(pending.current);
      pending.current = null;
    }
  }, [locked, glide]);

  // the back button can change the page under an open menu
  useEffect(() => { setMenu(false); }, [location.pathname]);

  // there are no customer accounts; an old account link lands on the home page
  useEffect(() => {
    if (/^\/account(\/|$)/.test(location.pathname)) navigate('/', { replace: true });
  }, [location.pathname, navigate]);

  const openProduct = useCallback((product) => navigate(`/products/${product.handle}`), [navigate]);
  // a piece opened from the catalogue layers over it; Close lands back on it
  const openFromCatalogue = useCallback(
    (product) => navigate(`/products/${product.handle}`, { state: { catalogue: here } }),
    [navigate, here],
  );
  // piece to piece inside the product page, so Close leaves all of them at once
  const openRelated = useCallback((product) => sheetNavigate(`/products/${product.handle}`), [sheetNavigate]);
  const openCatalogue = useCallback((handle) => navigate(`/collections/${handle ?? 'all'}`), [navigate]);
  const openSearch = useCallback(() => navigate('/search'), [navigate]);

  const closeBag = useCallback(() => {
    closeCart();
    if (route.kind === 'cart') closeOverlay();
  }, [closeCart, closeOverlay, route.kind]);

  const checkout = useCallback(() => {
    closeCart();
    navigate('/checkout', { replace: route.kind === 'cart' });
  }, [closeCart, navigate, route.kind]);

  return (
    <>
      <Preloader onDone={() => setReady(true)} />
      <Cursor />

      <Nav
        onMenu={() => setMenu((m) => !m)}
        menuOpen={menu}
        onSearch={openSearch}
        page={!home}
      />
      <MobileMenu
        open={menu}
        onClose={() => setMenu(false)}
        onAll={() => openCatalogue(null)}
      />

      {/* under a page, the home page is out of reach of the keyboard and screen readers */}
      <main inert={!home}>
        <Hero />
        {/* the sections, in the order the admin's website management sets */}
        {sections.map((s) => (
          <React.Fragment key={s.key}>{SECTION_VIEWS[s.key]?.({ openProduct, openCatalogue })}</React.Fragment>
        ))}
        <Newsletter />
      </main>

      <Footer inert={!home} />

      {/* the product page covers the screen on its own, so only the bag
          needs a scrim behind it */}
      <div className={`scrim ${cartOpen ? 'on' : ''}`} onClick={closeBag} />
      <Catalogue
        path={catalogue}
        top={route.kind === 'catalogue'}
        onClose={closeOverlay}
        onOpen={openFromCatalogue}
      />
      <CartDrawer open={cartOpen} onClose={closeBag} onCheckout={checkout} />
      <Checkout open={route.kind === 'checkout'} onClose={closeOverlay} />
      <OrderSheet token={route.kind === 'order' ? route.token : null} onClose={closeOverlay} />
      <PageSheet handle={route.kind === 'page' ? route.handle : null} onClose={closeOverlay} />
      <ProductPage
        handle={route.kind === 'product' ? route.handle : null}
        onClose={closeOverlay}
        onOpen={openRelated}
      />

      <div className={`toast ${toast ? 'on' : ''}`} role="status" aria-live="polite">
        <span className="label">{toast || ''}</span>
      </div>
    </>
  );
}
