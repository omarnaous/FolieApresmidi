import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App';
import { CartProvider } from './store/cart';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <CartProvider>
      <App />
    </CartProvider>
  </React.StrictMode>
);
