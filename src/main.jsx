import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import './styles.css';
import App from './App';
import { CartProvider } from './store/cart';
import { createQueryClient, seedInitialData } from './lib/queryClient';

// The admin is its own chunk and its own app — no preloader, cursor or Lenis.
const AdminApp = lazy(() => import('./admin/AdminApp'));

const queryClient = createQueryClient();
seedInitialData(queryClient);

// Any server-rendered snapshot inside #root is simply replaced on mount.
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/admin/*" element={<Suspense fallback={null}><AdminApp /></Suspense>} />
          <Route path="*" element={<CartProvider><App /></CartProvider>} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
