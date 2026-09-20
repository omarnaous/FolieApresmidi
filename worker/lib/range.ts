export type ByteRange = { start: number; end: number };

/**
 * A single `Range: bytes=…` header resolved against a known size. `null`
 * means serve the whole body (no header, or one we do not handle, such as
 * several ranges at once); `'unsatisfiable'` means answer 416.
 */
export function parseRange(header: string | null | undefined, size: number): ByteRange | 'unsatisfiable' | null {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m || (m[1] === '' && m[2] === '')) return null;

  if (m[1] === '') {
    // a suffix: the last n bytes
    const n = Number(m[2]);
    if (n === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - n), end: size - 1 };
  }

  const start = Number(m[1]);
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}
