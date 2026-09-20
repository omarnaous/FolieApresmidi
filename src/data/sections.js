import { useMemo } from 'react';
import { useStore } from '../lib/queries';

/**
 * The page, in order. One list so the nav, the mobile menu and the sections
 * themselves can never disagree about what exists or what it is called.
 *
 *   key   matches the store's home.sections, where the owner renames it and
 *         switches it off
 *   label the full name, used where there is room
 *   short the nav version, because the top bar is not that wide
 *
 * The names here are the defaults; the admin's Home page overrides them.
 * The film is 01, so the sections below start at 02 — and the numbers are
 * counted off the sections actually showing, so switching one off leaves no
 * gap in the sequence.
 */
export const SECTIONS = [
  { key: 'maison',      label: 'Maison FDM',       short: 'Maison',      href: '#maison' },
  { key: 'boutique',    label: 'The boutique',     short: 'Boutique',    href: '#boutique' },
  { key: 'accessories', label: 'Accessories',      short: 'Accessories', href: '#accessories' },
  { key: 'journal',     label: 'Limited edition',  short: 'Edition',     href: '#journal' },
  { key: 'popups',      label: 'Where to find us', short: 'Find us',     href: '#popups' },
];

const FIRST = 2;

/** The sections on the page: the owner's names, in order, numbered — the ones switched off left out. */
export function useSections() {
  const { data: store } = useStore();
  const saved = store?.home?.sections;
  return useMemo(
    () =>
      SECTIONS.map((s) => {
        const named = saved?.find((x) => x.key === s.key);
        return named ? { ...s, label: named.label, short: named.navLabel, visible: named.visible } : { ...s, visible: true };
      })
        .filter((s) => s.visible)
        .map((s, i) => ({ ...s, n: String(i + FIRST).padStart(2, '0') })),
    [saved],
  );
}

/** Whether a section is on the page at all — the home page asks before rendering one. */
export function useSectionShown(key) {
  return useSections().some((s) => s.key === key);
}

/** `02 — Maison FDM`, the way every section eyebrow is written. */
export function useEyebrow(href) {
  const s = useSections().find((x) => x.href === href);
  return s ? `${s.n} — ${s.label}` : '';
}
