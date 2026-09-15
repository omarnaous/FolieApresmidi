/**
 * The page, in order. One list so the nav, the mobile menu and the sections
 * themselves can never disagree about what exists or what it is called.
 *
 *   n     the eyebrow number the section prints
 *   label the full name, used where there is room
 *   short the nav version, because the top bar is not that wide
 */
export const SECTIONS = [
  { n: '02', label: 'The elevator',    short: 'Elevator',  href: '#maison' },
  { n: '03', label: 'The boutique',    short: 'Boutique',  href: '#boutique' },
  { n: '04', label: 'Limited edition', short: 'Edition',   href: '#journal' },
  { n: '05', label: 'The lookbook',    short: 'Lookbook',  href: '#lookbook' },
  { n: '06', label: 'Where to find us', short: 'Find us',  href: '#popups' },
];

/** `02 — The elevator`, the way every section eyebrow is written. */
export const eyebrow = (href) => {
  const s = SECTIONS.find((x) => x.href === href);
  return s ? `${s.n} — ${s.label}` : '';
};
