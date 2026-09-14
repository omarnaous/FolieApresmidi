/**
 * ─────────────────────────────────────────────────────────────
 *  ART DIRECTION
 * ─────────────────────────────────────────────────────────────
 *  The campaign film is the store's own footage, re-encoded for the
 *  web (9.4 MB → 304 KB; it is a locked-off plate, so it compresses
 *  hard). Everything else is drawn from the live catalogue, so the
 *  lookbook and the boutique can never drift apart.
 */

import { PRODUCTS } from './products';

/**
 * Campaign frames lifted from @folliesdapresmidi. Instagram serves a
 * logged-out grid at 640px, so the film frames them as plates rather
 * than running them full-bleed — at 30–45% of the frame they land at
 * roughly 1:1 and stay sharp, and the contact-sheet beat is sharper
 * still. Dates are the real post dates; they caption the sheet.
 */
export const post = (code) => `https://www.instagram.com/p/${code}/`;

/**
 * Vite rewrites asset URLs it can see (imports, CSS url(), index.html) for
 * the deploy base, but not plain strings like this. GitHub Pages serves the
 * site from /FolieApresmidi/, so these have to be built off BASE_URL or they
 * resolve to the domain root and 404.
 */
const asset = (path) => `${import.meta.env.BASE_URL}${path}`;

export const FEED = [
  { src: asset('media/ig/08-bags.jpg'),       w: 480, h: 640, date: '22.07.26', code: 'DbGpzmZO8Wr', label: 'The elevator' },
  { src: asset('media/ig/09-portrait.jpg'),   w: 480, h: 640, date: '20.07.26', code: 'DbBoCVuuRCL', label: 'The earring' },
  { src: asset('media/ig/04-necklace.jpg'),   w: 640, h: 565, date: '08.08.26', code: 'DbxwPwsKb_9', label: 'The gold chain' },
  { src: asset('media/ig/05-limo-a.jpg'),     w: 640, h: 433, date: '08.08.26', code: 'DbyHFO2qH3Q', label: 'The back seat' },
  { src: asset('media/ig/07-sunglasses.jpg'), w: 640, h: 480, date: '04.08.26', code: 'DboGWhBgsE3', label: 'The sunglasses' },
  { src: asset('media/ig/12-lace.jpg'),       w: 480, h: 640, date: '13.07.26', code: 'DavkNIAuSb3', label: 'The blue' },
  { src: asset('media/ig/02-party.jpg'),      w: 360, h: 640, date: '22.08.26', code: 'DcWXIg6q6ZT', label: 'The pop-up' },
  { src: asset('media/ig/03-car.jpg'),        w: 640, h: 360, date: '10.08.26', code: 'Db3uxqvOUTU', label: 'The drive' },
  { src: asset('media/ig/06-limo-b.jpg'),     w: 640, h: 449, date: '08.08.26', code: 'DbxqBuiub7U', label: 'The night' },
  { src: asset('media/ig/10-detail.jpg'),     w: 480, h: 640, date: '15.07.26', code: 'Da0rTC9ukIS', label: 'The stone' },
];

const at = (code) => FEED.find((f) => f.code === code);

/** Act II — the frame that carries the first title card. */
export const HERO_FRAME = at('DbGpzmZO8Wr');          // the orange bags

/** Act III — the contact sheet. */
export const SHEET = [
  at('DbxwPwsKb_9'), at('DbBoCVuuRCL'), at('DboGWhBgsE3'),
  at('DbyHFO2qH3Q'), at('DavkNIAuSb3'), at('DcWXIg6q6ZT'),
];

/** Act IV — three frames printed on paper. */
export const PAPER = [at('Da0rTC9ukIS'), at('DavkNIAuSb3'), at('Db3uxqvOUTU')];

/** Act V — the frame the wordmark sits over. */
export const FINALE = at('DbxqBuiub7U');               // two at the car, night

const pick = (...ids) => ids.map((id) => PRODUCTS.find((p) => p.id === id)).filter(Boolean);

/** Six pieces of the current drop, in the order they read best. */
export const LOOKS = pick(
  'mini-robe-rouge',        // La chaleur qui reste
  'stole-my-dads-blazer',   // No rush
  'overall',                // Corps d'après-midi
  'bomber-jacket',          // La dominante
  'jupe-etagere',           // Etagère
  'bralette-triangle'       // Presque rien
);

/** Editorial stack. */
export const EDITO = pick('zebre', 'bouquet', 'l-heure-defendue');

/** Held behind the preloader. */
export const CRITICAL = [
  HERO_FRAME.src,
  ...SHEET.slice(0, 3).map((f) => f.src),
  ...PRODUCTS.slice(0, 2).map((p) => p.images[0]),
];
