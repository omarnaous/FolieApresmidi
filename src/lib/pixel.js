import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

/**
 * The Meta Pixel. Meta's snippet is an inline script, which the page's CSP
 * refuses, so the same loader lives here and ships in the bundle. The back
 * office is never tracked.
 */
const PIXEL_ID = '1380099144201552';

function load() {
  if (window.fbq) return;
  const fbq = function (...args) {
    fbq.callMethod ? fbq.callMethod(...args) : fbq.queue.push(args);
  };
  window.fbq = fbq;
  if (!window._fbq) window._fbq = fbq;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = '2.0';
  fbq.queue = [];
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://connect.facebook.net/en_US/fbevents.js';
  document.head.appendChild(s);
  fbq('init', PIXEL_ID);
}

/** A PageView for the first page and for every page the shop routes to after it. */
export function MetaPixel() {
  const { pathname } = useLocation();
  const last = useRef(null);
  useEffect(() => {
    if (pathname.startsWith('/admin') || pathname === last.current) return;
    last.current = pathname;
    load();
    window.fbq('track', 'PageView');
  }, [pathname]);
  return null;
}
