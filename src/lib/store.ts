/** The store's Instagram, however it was typed in settings — "@name", "name" or a profile URL — as a bare handle. */
export function instagramHandle(value: string | null | undefined): string | null {
  if (!value) return null;
  const handle = value
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^@/, '')
    .replace(/\/.*$/, '');
  return handle || null;
}
