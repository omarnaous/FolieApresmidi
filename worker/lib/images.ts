/**
 * Uploads are identified by their bytes, never by the name or the declared
 * type. SVG is refused outright: it is a document that can carry script.
 */
export type ImageKind = { mime: string; ext: string };

export function sniffImage(bytes: Uint8Array): ImageKind | null {
  const at = (i: number) => bytes[i] ?? -1;
  const ascii = (from: number, len: number) => String.fromCharCode(...bytes.slice(from, from + len));
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (at(0) === 0x89 && ascii(1, 3) === 'PNG') return { mime: 'image/png', ext: 'png' };
  if (ascii(0, 4) === 'GIF8') return { mime: 'image/gif', ext: 'gif' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (ascii(4, 4) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 4))) return { mime: 'image/avif', ext: 'avif' };
  return null;
}

/**
 * The ftyp brands that are pictures, not films — HEIC and AVIF stills share
 * the MP4 container. Every other brand is a film: cameras, phones and editors
 * write dozens (isom, iso4–iso9, mp41, mp42, avc1, M4V, qt, dash, 3gp4, MSNV,
 * XAVC…), and a list of the allowed ones turned real films away.
 */
const STILL_BRANDS = ['avif', 'avis', 'heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'];
/** A QuickTime file old enough to have no ftyp box opens straight on one of these. */
const QUICKTIME_BOXES = ['moov', 'mdat', 'wide', 'free', 'skip', 'pnot'];

/**
 * The two files the site itself uses: the opening film and the notebook the
 * Limited edition section hands out. Sniffed by their bytes, like the images.
 * An MP4, M4V or MOV is one container family and is served as video/mp4:
 * every browser plays an H.264 .mov that way.
 */
export function sniffSiteFile(bytes: Uint8Array): ImageKind | null {
  const ascii = (from: number, len: number) => String.fromCharCode(...bytes.slice(from, from + len));
  if (ascii(0, 4) === '%PDF') return { mime: 'application/pdf', ext: 'pdf' };
  if (ascii(4, 4) === 'ftyp') return STILL_BRANDS.includes(ascii(8, 4)) ? null : { mime: 'video/mp4', ext: 'mp4' };
  if (QUICKTIME_BOXES.includes(ascii(4, 4))) return { mime: 'video/mp4', ext: 'mp4' };
  return null;
}

/** How many leading bytes sniffSiteFile needs. */
export const SITE_FILE_SNIFF_BYTES = 12;

/**
 * A film is big; a notebook is not. Cloudflare takes a request body of up
 * to 100 MB on this plan, so the ceiling sits just under it. One file a
 * request, streamed through to storage — never held whole in memory.
 */
export const MAX_SITE_FILE_BYTES = 95 * 1024 * 1024;

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_FILES = 20;

/** Media widths the pipeline serves; others round up (bounds unique transformations). */
export const WIDTHS = [320, 640, 960, 1400, 2000];
export const snapWidth = (w: number): number => WIDTHS.find((x) => x >= w) ?? WIDTHS[WIDTHS.length - 1]!;
