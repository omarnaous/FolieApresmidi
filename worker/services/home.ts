import { HOME_SECTIONS, type AdminHomeDTO, type FloorDTO, type HomeDTO, type HomeInput, type HomeSectionDTO, type MediaDTO, type PopUpDTO } from '../../shared/api';
import { parseJson } from '../db/client';
import { chunk, mediaByIdsRaw } from './media';

/**
 * The home page copy the owner edits in the admin: the section names, the
 * Maison heading and the floors of its lift directory. Stored as one JSON
 * document on store_settings.home_json; anything missing from it falls back
 * to the defaults below, so a store that never saved it still reads well.
 */

interface StoredFloor {
  name: string;
  line: string | null;
  collectionHandle: string | null;
  imageMediaId: string | null;
}

export interface Home {
  sections: HomeSectionDTO[];
  hero: { videoMediaId: string | null };
  ribbon: string[];
  maison: { heading: string; intro: string | null };
  floors: StoredFloor[];
  boutique: { heading: string | null; intro: string | null };
  accessories: { heading: string; intro: string | null };
  journal: { heading: string; intro: string; buttonLabel: string; notebookMediaId: string | null };
  popups: { heading: string; intro: string | null; rows: PopUpDTO[] };
  footer: { blurb: string; careNote: string | null };
}

export const HOME_DEFAULTS: Home = {
  sections: [
    { key: 'maison', label: 'Maison FDM', navLabel: 'Maison', visible: true },
    { key: 'boutique', label: 'The boutique', navLabel: 'Boutique', visible: true },
    { key: 'accessories', label: 'Accessories', navLabel: 'Accessories', visible: true },
    { key: 'journal', label: 'Limited edition', navLabel: 'Edition', visible: true },
    { key: 'popups', label: 'Where to find us', navLabel: 'Find us', visible: true },
  ],
  maison: {
    heading: 'Four floors, *one long afternoon*',
    intro:
      'Step in and let the doors close behind you. The house rises a floor at a time — every stop its own mood, every piece made in Lebanon. Take the lift, or take the stairs and linger.',
  },
  accessories: {
    // "bold colors, refined details" — the house's own words, from its About page
    heading: 'Bold colour, *refined detail*',
    intro: 'Gold, stone and pearl — designed and produced in limited quantities in Lebanon.',
  },
  floors: [
    { name: 'Tops', line: 'Draped, cropped, bare-shouldered. The first thing they notice.', collectionHandle: 'tops', imageMediaId: null },
    { name: 'Bottoms', line: 'Skirts that sway and trousers that walk tall.', collectionHandle: 'bottoms', imageMediaId: null },
    { name: 'Bralettes', line: 'Lace and triangles, cut to be seen.', collectionHandle: 'bralettes', imageMediaId: null },
    { name: 'Accessories', line: 'Gold, stone and the last word.', collectionHandle: 'jewellery', imageMediaId: null },
  ],
  hero: { videoMediaId: null },
  ribbon: ['Épicée', 'Libre', 'Échappée 4 à 7', 'Made in Lebanon', 'Limited quantities', 'Prêt-à-porter'],
  boutique: { heading: null, intro: null },
  journal: {
    heading: 'Limited quantities. *Made in Lebanon.*',
    intro:
      'Pieces for women who dress with confidence, attitude and instinct — who value exclusivity, comfort and craftsmanship, and clothes that feel alive. FDM is not only about what you wear, but the mood you step into.',
    buttonLabel: 'Where to find us',
    notebookMediaId: null,
  },
  popups: {
    heading: 'End of summer *pop-ups*',
    intro: 'Clothes and drinks. No appointment, no list.',
    rows: [
      { place: 'Beit Misk', city: 'Mount Lebanon', dates: '04 — 06 September', time: 'From 16:00', status: 'open' },
      { place: 'Soul Beach', city: 'Batroun', dates: '15 September', time: 'From 10:00', status: 'open' },
      { place: 'Emergency Room', city: 'Beirut', dates: '09 July', time: 'Archive', status: 'past' },
    ],
  },
  footer: {
    blurb: 'Luxury prêt-à-porter, designed and produced in limited quantities in Lebanon. Épicée. Libre.',
    careNote: 'Exchanges within 24 hours. No refunds.',
  },
};

export function readHome(json: string | null | undefined): Home {
  const stored = parseJson<Partial<Home>>(json ?? '{}', {});
  /* Saved order wins, and any section the store has never heard of is added at
     the end — so a section shipped after the owner last saved still appears. */
  const order = [
    ...(stored.sections ?? []).map((s) => s.key).filter((key) => HOME_SECTIONS.includes(key)),
    ...HOME_SECTIONS.filter((key) => !(stored.sections ?? []).some((s) => s.key === key)),
  ];
  const sections = order.map((key) => {
    const fallback = HOME_DEFAULTS.sections.find((s) => s.key === key)!;
    const saved = stored.sections?.find((s) => s.key === key);
    // a store saved before a section could be hidden shows it, as it did then
    return saved ? { key, label: saved.label, navLabel: saved.navLabel, visible: saved.visible !== false } : fallback;
  });
  return {
    sections,
    // every field below falls back on its own: a store that saved before a
    // section (or a whole piece of copy) existed still reads as it did then
    hero: { videoMediaId: stored.hero?.videoMediaId ?? null },
    ribbon: stored.ribbon?.length ? stored.ribbon : HOME_DEFAULTS.ribbon,
    maison: stored.maison ?? HOME_DEFAULTS.maison,
    floors: stored.floors?.length ? stored.floors : HOME_DEFAULTS.floors,
    boutique: stored.boutique ?? HOME_DEFAULTS.boutique,
    accessories: stored.accessories ?? HOME_DEFAULTS.accessories,
    journal: stored.journal?.intro ? stored.journal : HOME_DEFAULTS.journal,
    popups: stored.popups?.rows?.length ? stored.popups : HOME_DEFAULTS.popups,
    footer: stored.footer?.blurb ? stored.footer : HOME_DEFAULTS.footer,
  };
}

/** The document PUT /api/admin/home stores, from its validated input. */
export const homeFromInput = (input: HomeInput): Home => ({
  sections: input.sections.map((s) => ({ key: s.key, label: s.label, navLabel: s.navLabel, visible: s.visible ?? true })),
  hero: { videoMediaId: input.hero?.videoMediaId ?? null },
  ribbon: (input.ribbon ?? []).map((w) => w.trim()).filter(Boolean),
  maison: { heading: input.maison.heading, intro: input.maison.intro ?? null },
  floors: input.floors.map((f) => ({
    name: f.name,
    line: f.line ?? null,
    collectionHandle: f.collectionHandle,
    imageMediaId: f.imageMediaId,
  })),
  boutique: { heading: input.boutique?.heading ?? null, intro: input.boutique?.intro ?? null },
  accessories: { heading: input.accessories.heading, intro: input.accessories.intro ?? null },
  journal: {
    heading: input.journal!.heading,
    intro: input.journal!.intro,
    buttonLabel: input.journal!.buttonLabel,
    notebookMediaId: input.journal!.notebookMediaId ?? null,
  },
  popups: {
    heading: input.popups!.heading,
    intro: input.popups!.intro ?? null,
    rows: (input.popups!.rows ?? []).map((r) => ({ place: r.place, city: r.city, dates: r.dates, time: r.time, status: r.status ?? 'open' })),
  },
  footer: { blurb: input.footer!.blurb, careNote: input.footer!.careNote ?? null },
});

/**
 * Each published collection's picture: its own image, or else the first
 * image of the first active piece in it.
 */
async function collectionCovers(d1: D1Database, handles: string[]): Promise<Map<string, string>> {
  const covers = new Map<string, string>();
  for (const part of chunk([...new Set(handles)])) {
    const { results } = await d1
      .prepare(
        `SELECT c.handle,
                COALESCE(c.image_media_id, (
                  SELECT pm.media_id
                    FROM collection_products cp
                    JOIN products p ON p.id = cp.product_id AND p.status = 'active'
                    JOIN product_media pm ON pm.product_id = p.id
                   WHERE cp.collection_id = c.id
                   ORDER BY cp.position, p.position, pm.position
                   LIMIT 1
                )) AS media_id
           FROM collections c
          WHERE c.published = 1 AND c.handle IN (${part.map(() => '?').join(',')})`,
      )
      .bind(...part)
      .all<{ handle: string; media_id: string | null }>();
    for (const r of results) if (r.media_id) covers.set(r.handle, r.media_id);
  }
  return covers;
}

async function resolveFloors(d1: D1Database, floors: StoredFloor[]) {
  const covers = await collectionCovers(d1, floors.flatMap((f) => (f.collectionHandle ? [f.collectionHandle] : [])));
  const media = await mediaByIdsRaw(d1, [...floors.flatMap((f) => (f.imageMediaId ? [f.imageMediaId] : [])), ...covers.values()]);
  return floors.map((f) => {
    const chosen = f.imageMediaId ? media.get(f.imageMediaId) ?? null : null;
    const coverId = f.collectionHandle ? covers.get(f.collectionHandle) : undefined;
    const fallback: MediaDTO | null = coverId ? media.get(coverId) ?? null : null;
    return { floor: f, chosen, fallback };
  });
}

/** The film and the notebook, which are ordinary media rows holding a video and a PDF. */
async function resolveFiles(d1: D1Database, home: Home) {
  const ids = [home.hero.videoMediaId, home.journal.notebookMediaId].filter((id): id is string => !!id);
  const media = await mediaByIdsRaw(d1, ids);
  return {
    video: home.hero.videoMediaId ? media.get(home.hero.videoMediaId) ?? null : null,
    notebook: home.journal.notebookMediaId ? media.get(home.journal.notebookMediaId) ?? null : null,
  };
}

/** The copy shared by both DTOs, so the shop and the admin can never disagree. */
const common = (home: Home, notebook: MediaDTO | null, video: MediaDTO | null) => ({
  sections: home.sections,
  hero: { video },
  ribbon: home.ribbon,
  maison: home.maison,
  boutique: home.boutique,
  accessories: home.accessories,
  journal: { heading: home.journal.heading, intro: home.journal.intro, buttonLabel: home.journal.buttonLabel, notebook },
  popups: home.popups,
  footer: home.footer,
});

export async function homeDTO(d1: D1Database, home: Home): Promise<HomeDTO> {
  const [{ video, notebook }, resolved] = await Promise.all([resolveFiles(d1, home), resolveFloors(d1, home.floors)]);
  const floors: FloorDTO[] = resolved.map(({ floor, chosen, fallback }) => ({
    name: floor.name,
    line: floor.line,
    collectionHandle: floor.collectionHandle,
    image: chosen ?? fallback,
  }));
  return { ...common(home, notebook, video), floors };
}

export async function adminHomeDTO(d1: D1Database, home: Home, updatedAt: number): Promise<AdminHomeDTO> {
  const [{ video, notebook }, resolved] = await Promise.all([resolveFiles(d1, home), resolveFloors(d1, home.floors)]);
  const floors = resolved.map(({ floor, chosen, fallback }) => ({
    name: floor.name,
    line: floor.line,
    collectionHandle: floor.collectionHandle,
    image: chosen,
    fallback,
  }));
  return { ...common(home, notebook, video), floors, updatedAt };
}
