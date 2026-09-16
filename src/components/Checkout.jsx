import React from 'react';
import { Sheet } from '../ui/Sheet';
import CheckoutFlow from '../checkout/CheckoutFlow';
import { useLinger } from '../hooks/useSheet';

/**
 * The checkout sheet. The flow inside mounts each time it opens, so every
 * visit starts from the bag as it is now, and stays through the slide-out.
 */
export default function Checkout({ open, onClose }) {
  const mounted = useLinger(open, 620);

  return (
    <Sheet open={open} label="Checkout" back="Keep shopping" onClose={onClose}>
      {mounted && <CheckoutFlow onClose={onClose} />}
    </Sheet>
  );
}
