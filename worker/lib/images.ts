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

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_FILES = 20;

/** Media widths the pipeline serves; others round up (bounds unique transformations). */
export const WIDTHS = [320, 640, 960, 1400, 2000];
export const snapWidth = (w: number): number => WIDTHS.find((x) => x >= w) ?? WIDTHS[WIDTHS.length - 1]!;
