import React, { createContext, useContext, useEffect, useMemo, useReducer, useState, useCallback } from 'react';

const KEY = 'fdm.bag.v1';
const CartCtx = createContext(null);

const load = () => {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? []; } catch { return []; }
};

function reducer(state, action) {
  switch (action.type) {
    case 'add': {
      const { product, size, colour } = action;
      const key = `${product.id}::${size}::${colour ?? '-'}`;
      const found = state.find((l) => l.key === key);
      if (found) return state.map((l) => (l.key === key ? { ...l, qty: Math.min(l.qty + 1, 9) } : l));
      return [
        ...state,
        {
          key,
          id: product.id,
          name: product.name,
          price: product.price,
          image: product.images[0],
          size,
          colour: colour ?? null,
          qty: 1,
        },
      ];
    }
    case 'qty':
      return state
        .map((l) => (l.key === action.key ? { ...l, qty: Math.max(0, Math.min(l.qty + action.by, 9)) } : l))
        .filter((l) => l.qty > 0);
    case 'remove':
      return state.filter((l) => l.key !== action.key);
    case 'clear':
      return [];
    default:
      return state;
  }
}

export function CartProvider({ children }) {
  const [lines, dispatch] = useReducer(reducer, undefined, load);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch { /* private mode */ }
  }, [lines]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const add = useCallback((product, size, colour = null) => {
    dispatch({ type: 'add', product, size, colour });
    const spec = [colour, size === 'One size' ? null : size].filter(Boolean).join(' / ');
    setToast(spec ? `${product.name} — ${spec} added` : `${product.name} added`);
  }, []);

  const value = useMemo(() => {
    const count = lines.reduce((n, l) => n + l.qty, 0);
    const subtotal = lines.reduce((n, l) => n + l.qty * l.price, 0);
    return {
      lines, count, subtotal, open, toast,
      add,
      qty: (key, by) => dispatch({ type: 'qty', key, by }),
      remove: (key) => dispatch({ type: 'remove', key }),
      clear: () => dispatch({ type: 'clear' }),
      openCart: () => setOpen(true),
      closeCart: () => setOpen(false),
    };
  }, [lines, open, toast, add]);

  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>;
}

export const useCart = () => {
  const ctx = useContext(CartCtx);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
};

export const money = (n) => `$${n.toLocaleString('en-US')}`;
