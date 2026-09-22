import React from 'react';
import { Sheet } from '../ui/Sheet';
import CheckoutFlow from '../checkout/CheckoutFlow';
import { useLinger } from '../hooks/useSheet';

/**
 * The checkout sheet. The flow inside mounts each time it opens, so every
 * visit starts from the bag as it is now, and stays through the slide-out.
 *
 * Alone among the sheets it cannot be swiped away: pulling down at the top
 * of a half-filled checkout threw the whole thing away, and the sheet moved
 * under the finger while it happened, which read as the page scrolling
 * badly. Leaving is the bar's two words, deliberately pressed.
 */
export default function Checkout({ open, onClose }) {
  const mounted = useLinger(open, 620);

  return (
    <Sheet open={open} label="Checkout" back="Keep shopping" swipeToClose={false} onClose={onClose}>
      {mounted && <CheckoutFlow onClose={onClose} />}
    </Sheet>
  );
}
