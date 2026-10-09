/**
 * The lookbook plates — editorial photographs, kept in R2 and served from the
 * shop's own /media path. No piece, no price: the look book is the house's
 * images on their own. Add or reorder by editing this list.
 */
export const LOOKBOOK = Array.from(
  { length: 69 },
  (_, i) => `/media/lookbook/${String(i + 1).padStart(2, '0')}.jpg`,
);
