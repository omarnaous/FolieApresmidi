import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import './styles.css';
import App from './App';
import { CartProvider } from './store/cart';
import { createQueryClient, seedInitialData } from './lib/queryClient';
import { onCatalogChange } from './lib/sync';
import { pageView, startPixel } from './lib/metaPixel';

// The admin is its own chunk and its own app — no preloader, cursor or Lenis.
const AdminApp = lazy(() => import('./admin/AdminApp'));

const queryClient = createQueryClient();
seedInitialData(queryClient);

// a save in an admin tab beside this one: the shop fetches everything afresh
onCatalogChange(() => {
  if (!location.pathname.startsWith('/admin')) void queryClient.invalidateQueries();
});

/** The Meta pixel's page views: the shop never reloads, so each route change is one. */
function PixelPageViews() {
  const { pathname, search } = useLocation();
  React.useEffect(() => {
    if (pathname.startsWith('/admin')) return;
    startPixel();
    pageView(pathname + search);
  }, [pathname, search]);
  return null;
}

// Any server-rendered snapshot inside #root is simply replaced on mount.
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <PixelPageViews />
        <Routes>
          <Route path="/admin/*" element={<Suspense fallback={null}><AdminApp /></Suspense>} />
          <Route path="*" element={<CartProvider><App /></CartProvider>} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
