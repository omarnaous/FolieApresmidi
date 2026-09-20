import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { del, patch, post } from '../lib/api';
import { qk, useCartQuery } from '../lib/queries';
import { messageFor } from '../lib/errors';
import { resolveVariant } from '../lib/catalog';

/** Where the bag lived before the server cart; cleared once, on first load. */
const LEGACY_KEY = 'fdm.bag.v1';
const CartCtx = createContext(null);

/** The bag as it reads with one line at a new quantity, before the server agrees. */
function withQuantity(cart, lineId, quantity) {
  const lines = cart.lines
    .map((l) => (l.id === lineId ? { ...l, quantity, lineTotal: l.unitPrice * quantity } : l))
    .filter((l) => l.quantity > 0);
  return {
    ...cart,
    lines,
    itemCount: lines.reduce((n, l) => n + l.quantity, 0),
    subtotal: lines.reduce((n, l) => n + l.lineTotal, 0),
    warnings: cart.warnings.filter((w) => lines.some((l) => l.id === w.lineId)),
  };
}

export function CartProvider({ children }) {
  const client = useQueryClient();
  const { data: cart } = useCartQuery();
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [pending, setPending] = useState(0);
  const queue = useRef(Promise.resolve());
  const latest = useRef(0);

  useEffect(() => {
    try { localStorage.removeItem(LEGACY_KEY); } catch { /* private mode */ }
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  /* Writes go out one at a time, in the order they were made: quantities are
     absolute, so a slow reply must never land on top of a newer tap. Only the
     newest reply is written into the cache. */
  const send = useCallback((request) => {
    const n = ++latest.current;
    setPending((p) => p + 1);
    const run = queue.current.then(request);
    queue.current = run.then(() => undefined, () => undefined);
    return run
      .then((next) => {
        if (n === latest.current) client.setQueryData(qk.cart, next);
        return next;
      })
      .finally(() => setPending((p) => p - 1));
  }, [client]);

  /** Show the bag as it will be, send the change, and put it back if the server says no. */
  const change = useCallback(async (lineId, quantity, request) => {
    const before = client.getQueryData(qk.cart);
    if (!before) return;
    await client.cancelQueries({ queryKey: qk.cart });
    client.setQueryData(qk.cart, withQuantity(before, lineId, quantity));
    try {
      await send(request);
    } catch (err) {
      client.setQueryData(qk.cart, before);
      void client.invalidateQueries({ queryKey: qk.cart });
      setToast(messageFor(err));
    }
  }, [client, send]);

  const add = useCallback(async (product, choice) => {
    const variant = resolveVariant(product, choice);
    if (!variant) {
      setToast('Choose your options first');
      return false;
    }
    try {
      await send(() => post('/api/cart/lines', { variantId: variant.id, quantity: 1 }));
      const spec = variant.options.filter((v) => v !== 'One size' && v !== 'Default Title').join(' / ');
      setToast(spec ? `${product.title} — ${spec} added` : `${product.title} added`);
      return true;
    } catch (err) {
      setToast(messageFor(err, 'That did not go in the bag. Try again.'));
      return false;
    }
  }, [send]);

  const qty = useCallback((lineId, by) => {
    const line = client.getQueryData(qk.cart)?.lines.find((l) => l.id === lineId);
    if (!line) return;
    const cap = Math.min(99, line.maxQuantity ?? 99);
    const quantity = Math.max(0, Math.min(line.quantity + by, cap));
    if (quantity === line.quantity) {
      if (by > 0 && line.maxQuantity !== null) setToast(`Only ${line.maxQuantity} left`);
      return;
    }
    void change(lineId, quantity, () => patch(`/api/cart/lines/${lineId}`, { quantity }));
  }, [client, change]);

  const remove = useCallback(
    (lineId) => void change(lineId, 0, () => del(`/api/cart/lines/${lineId}`)),
    [change],
  );

  const openCart = useCallback(() => setOpen(true), []);
  const closeCart = useCallback(() => setOpen(false), []);

  const value = useMemo(() => ({
    cart: cart ?? null,
    lines: cart?.lines ?? [],
    count: cart?.itemCount ?? 0,
    subtotal: cart?.subtotal ?? 0,
    open,
    toast,
    busy: pending > 0,
    add,
    qty,
    remove,
    notify: setToast,
    openCart,
    closeCart,
  }), [cart, open, toast, pending, add, qty, remove, openCart, closeCart]);

  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>;
}

export const useCart = () => {
  const ctx = useContext(CartCtx);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
};
