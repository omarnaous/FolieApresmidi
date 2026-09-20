/**
 * ─────────────────────────────────────────────────────────────
 *  ART DIRECTION
 * ─────────────────────────────────────────────────────────────
 *  The campaign film is the store's own footage, re-encoded for the
 *  web (9.4 MB → 304 KB; it is a locked-off plate, so it compresses
 *  hard). The pieces themselves come from the catalogue API, so the
 *  home sections and the boutique can never drift apart.
 */

/**
 * Campaign frames lifted from @folliesdapresmidi, at the 640px Instagram
 * serves a logged-out grid. Dates are the real post dates.
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

/**
 * The hero film: the campaign film from the Shopify storefront with the
 * wordmark over it. Three cuts of the same 4:3 master (1440×1080, 25 fps,
 * 11.5 s), audio stripped, and its last frame as a still — the film rests
 * on the still (a paused video is not reliably painted) and falls back to
 * it if the video cannot play. The figure and the tree sit in the lower
 * right of the frame.
 */
export const OPENING = {
  1080: asset('film/hero-1080.mp4'),
  720: asset('film/hero-720.mp4'),
  480: asset('film/hero-480.mp4'),
  end: asset('film/hero-end.jpg'),
};

/**
 * The house logo: the arched wordmark over "Beirut, Liban", drawn from the
 * brand book's PDF. It is kept as an alpha mask — white pixels, the ink in
 * the alpha channel — so the page paints it in whatever colour it is asked
 * for (bone over the film, ink on paper) from one 35 KB file.
 */
export const LOGO = {
  lockup: asset('brand/lockup.png'),
  /** its own proportions, so the box never has to guess */
  ratio: 1562 / 513,
};
