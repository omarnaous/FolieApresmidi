export const cx = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(' ');

export const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "Summer Linen — Ivory" → "summer-linen-ivory" (matches zHandle). */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .replace(/-+$/g, '');
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

export function cartesian(lists: readonly (readonly string[])[]): string[][] {
  return lists.reduce<string[][]>((acc, values) => acc.flatMap((row) => values.map((v) => [...row, v])), [[]]);
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomCode(length = 8): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

let seq = 0;
/** Stable client-side keys for rows that have no id yet. */
export const clientKey = (prefix = 'k'): string => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

export const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
