/**
 * Where the accessories live: a parent collection for "All", and the
 * collections inside it. The boutique keeps these handles off its own tabs,
 * and a card knows from them that its photo was shot on grey.
 */
export const ACCESSORIES = {
  handle: 'jewellery',
  parts: ['necklaces', 'earrings', 'bracelets'],
};
export const ACCESSORY_HANDLES = new Set([ACCESSORIES.handle, ...ACCESSORIES.parts]);
