import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  HomeInput,
  imageSrc,
  MAX_LOOKBOOK,
  MAX_POPUPS,
  put,
  type AdminHomeDTO,
  type HomeSectionKey,
  type MediaDTO,
  type PopUpDTO,
} from '../../lib/contract';
import { apiFieldErrors, validate, type FieldErrors } from '../../lib/forms';
import { useUnsavedChanges } from '../../lib/hooks';
import { qk, useHome } from '../../lib/queries';
import { clientKey, moveItem, sameJson } from '../../lib/util';
import { Button, ButtonLink, IconButton } from '../../ui/Button';
import { ErrorBanner, FormErrorSummary, QueryState } from '../../ui/feedback';
import { Select, Textarea, TextInput, Toggle } from '../../ui/form';
import { IconArrowDown, IconArrowUp, IconChevronLeft, IconChevronRight, IconPlus, IconTrash } from '../../ui/icons';
import { Card, PageHeader, SaveBar } from '../../ui/layout';
import { ImageUploader } from '../../ui/media';
import { Thumb } from '../../ui/Table';
import { SiteFileField } from '../../ui/SiteFile';
import { WebsiteTabs } from './Tabs';
import { useToast } from '../../ui/Toasts';

/**
 * The number each section prints on the site: the film is 01, and the
 * sections showing are counted off from 02 — so switching one off closes the
 * gap rather than leaving one. A section that is off prints no number.
 */
const numbers = (sections: SectionRow[]): Record<string, string | null> => {
  let n = 2;
  return Object.fromEntries(sections.map((s) => [s.key, s.visible ? String(n++).padStart(2, '0') : null]));
};

interface SectionRow {
  key: HomeSectionKey;
  label: string;
  navLabel: string;
  visible: boolean;
}

interface PopUpRow extends PopUpDTO {
  key: string;
}

interface HomeDraft {
  sections: SectionRow[];
  video: MediaDTO | null;
  ribbon: string[];
  heading: string;
  intro: string;
  boutiqueHeading: string;
  boutiqueIntro: string;
  accessoriesHeading: string;
  accessoriesIntro: string;
  lookbookHeading: string;
  lookbookIntro: string;
  lookbook: MediaDTO[];
  journalHeading: string;
  journalIntro: string;
  journalButton: string;
  notebook: MediaDTO | null;
  popupsHeading: string;
  popupsIntro: string;
  popups: PopUpRow[];
  footerBlurb: string;
  footerCare: string;
}

const fromDTO = (h: AdminHomeDTO): HomeDraft => ({
  sections: h.sections.map((s) => ({ key: s.key, label: s.label, navLabel: s.navLabel, visible: s.visible })),
  video: h.hero.video,
  ribbon: h.ribbon,
  heading: h.maison.heading,
  intro: h.maison.intro ?? '',
  boutiqueHeading: h.boutique.heading ?? '',
  boutiqueIntro: h.boutique.intro ?? '',
  accessoriesHeading: h.accessories.heading,
  accessoriesIntro: h.accessories.intro ?? '',
  lookbookHeading: h.lookbook.heading,
  lookbookIntro: h.lookbook.intro ?? '',
  lookbook: h.lookbook.images,
  journalHeading: h.journal.heading,
  journalIntro: h.journal.intro,
  journalButton: h.journal.buttonLabel,
  notebook: h.journal.notebook,
  popupsHeading: h.popups.heading,
  popupsIntro: h.popups.intro ?? '',
  popups: h.popups.rows.map((r) => ({ ...r, key: clientKey('p') })),
  footerBlurb: h.footer.blurb,
  footerCare: h.footer.careNote ?? '',
});

export default function WebsitePage() {
  const q = useHome();
  if (!q.data) {
    return (
      <>
        <PageHeader title="Website design" docTitle="Home page" />
        <WebsiteTabs />
        <QueryState error={q.error} isPending={q.isPending} onRetry={() => void q.refetch()} />
      </>
    );
  }
  return <HomeForm home={q.data} />;
}

function HomeForm({ home }: { home: AdminHomeDTO }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [saved, setSaved] = useState(home);
  const [base, setBase] = useState<HomeDraft>(() => fromDTO(home));
  const [draft, setDraft] = useState<HomeDraft>(base);
  const [errors, setErrors] = useState<FieldErrors>({});
  const dirty = !sameJson(base, draft);
  useUnsavedChanges(dirty);

  const set = <K extends keyof HomeDraft>(k: K, v: HomeDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setSection = (key: HomeSectionKey, patch: Partial<SectionRow>) =>
    set('sections', draft.sections.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  const save = useMutation({
    mutationFn: (body: HomeInput) => put<AdminHomeDTO>('/api/admin/home', body),
    onSuccess: (dto) => {
      qc.setQueryData(qk.home, dto);
      void qc.invalidateQueries({ queryKey: qk.store });
      const next = fromDTO(dto);
      setSaved(dto);
      setBase(next);
      setDraft(next);
      setErrors({});
      toast.success('The website was saved');
    },
    onError: (err) => setErrors(apiFieldErrors(err)),
  });

  const submit = () => {
    if (save.isPending) return;
    const body: HomeInput = {
      sections: draft.sections.map((s) => ({ key: s.key, label: s.label, navLabel: s.navLabel, visible: s.visible })),
      hero: { videoMediaId: draft.video?.id ?? null },
      ribbon: draft.ribbon,
      maison: { heading: draft.heading, intro: draft.intro.trim() || null },
      boutique: { heading: draft.boutiqueHeading.trim() || null, intro: draft.boutiqueIntro.trim() || null },
      accessories: { heading: draft.accessoriesHeading, intro: draft.accessoriesIntro.trim() || null },
      lookbook: {
        heading: draft.lookbookHeading,
        intro: draft.lookbookIntro.trim() || null,
        imageMediaIds: draft.lookbook.map((m) => m.id),
      },
      journal: {
        heading: draft.journalHeading,
        intro: draft.journalIntro,
        buttonLabel: draft.journalButton,
        notebookMediaId: draft.notebook?.id ?? null,
      },
      popups: {
        heading: draft.popupsHeading,
        intro: draft.popupsIntro.trim() || null,
        rows: draft.popups.map((r) => ({ place: r.place, city: r.city, dates: r.dates, time: r.time, status: r.status })),
      },
      footer: { blurb: draft.footerBlurb, careNote: draft.footerCare.trim() || null },
    };
    const errs = validate(HomeInput, body) ?? {};
    setErrors(errs);
    if (Object.keys(errs).length) return window.scrollTo({ top: 0 });
    save.mutate(body);
  };

  const named = (key: HomeSectionKey, fallback: string) => draft.sections.find((s) => s.key === key)?.label || fallback;
  const maisonName = named('maison', 'Maison');
  const accessoriesName = named('accessories', 'Accessories');
  const number = numbers(draft.sections);
  /** "04 — Accessories", or "Accessories (switched off)" while it is hidden. */
  const cardTitle = (key: HomeSectionKey, name: string) => (number[key] ? `${number[key]} — ${name}` : `${name} (switched off)`);
  const addPopUp = () => set('popups', [...draft.popups, { key: clientKey('p'), place: '', city: '', dates: '', time: '', status: 'open' }]);
  const setPopUp = (key: string, patch: Partial<PopUpRow>) => set('popups', draft.popups.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  // what the boutique is called today, so the empty title field can show it
  const savedDropName = saved.boutique.heading ?? 'The featured collection';

  return (
    <>
      <PageHeader title="Website design" docTitle="Home page" />
      <WebsiteTabs />
      <FormErrorSummary errors={save.error ? {} : errors} />
      <ErrorBanner error={save.error} title="The website was not saved" />

      <div className="adm-stack">
        <Card title="Sections & navigation">
          <p className="adm-field__hint">
            The sections of the home page, in the order they appear. The name shows above each section and in the mobile menu; the short name is the
            link in the top bar. Switch one off and it leaves the page, the top bar and the menu — the rest keep consecutive numbers.
          </p>
          <ol className="adm-namerows">
            {draft.sections.map((s, i) => (
              <li key={s.key} className="adm-namerow">
                <span className="adm-namerow__num">{number[s.key] ?? '—'}</span>
                <TextInput
                  label="Name"
                  labelHidden={i > 0}
                  value={s.label}
                  maxLength={40}
                  error={errors[`sections.${i}.label`]}
                  onChange={(e) => setSection(s.key, { label: e.target.value })}
                />
                <TextInput
                  label="Top bar"
                  labelHidden={i > 0}
                  value={s.navLabel}
                  maxLength={20}
                  error={errors[`sections.${i}.navLabel`]}
                  onChange={(e) => setSection(s.key, { navLabel: e.target.value })}
                />
                <Toggle
                  label={`Show ${s.label || 'this section'} on the home page`}
                  labelHidden
                  checked={s.visible}
                  onChange={(visible) => setSection(s.key, { visible })}
                />
                <span className="adm-row adm-row--tight">
                  <IconButton
                    label={`Move ${s.label || 'this section'} up`}
                    disabled={i === 0}
                    onClick={() => set('sections', moveItem(draft.sections, i, i - 1))}
                  >
                    <IconArrowUp size={14} />
                  </IconButton>
                  <IconButton
                    label={`Move ${s.label || 'this section'} down`}
                    disabled={i === draft.sections.length - 1}
                    onClick={() => set('sections', moveItem(draft.sections, i, i + 1))}
                  >
                    <IconArrowDown size={14} />
                  </IconButton>
                </span>
              </li>
            ))}
          </ol>
        </Card>

        <Card title="01 — The film">
          <SiteFileField
            label="Opening film"
            kind="video"
            value={draft.video}
            error={errors['hero.videoMediaId']}
            hint="An MP4, up to 80 MB. It plays silently, full screen, on a loop. With nothing uploaded, the house's own campaign film plays."
            onChange={(video) => set('video', video)}
          />
        </Card>

        <Card title={cardTitle('maison', maisonName)}>
          <div className="adm-stack">
            <TextInput
              label="Heading"
              value={draft.heading}
              maxLength={80}
              error={errors['maison.heading']}
              hint="Wrap words in *asterisks* to set them in italics."
              onChange={(e) => set('heading', e.target.value)}
            />
            <Textarea
              label="Introduction"
              optional
              rows={3}
              maxLength={400}
              value={draft.intro}
              error={errors['maison.intro']}
              hint="Shown beside the heading."
              onChange={(e) => set('intro', e.target.value)}
            />
          </div>
        </Card>

        <Card
          title="Floors"
          actions={
            <ButtonLink size="sm" to="/admin/collections">
              Arrange collections
            </ButtonLink>
          }
        >
          <p className="adm-field__hint">
            The lift directory in {maisonName} is your collections, in the order set under <strong>Collections</strong> — the same order as the
            boutique’s tabs. Each floor takes its collection’s name, its subtitle as the line, and its picture (or its first piece’s). To change a
            floor, edit or reorder the collection.
          </p>
          {saved.floors.length === 0 ? (
            <p className="adm-muted adm-gap-top">No collections are on the shop yet.</p>
          ) : (
            <ol className="adm-orderlist adm-orderlist--inset adm-gap-top">
              {saved.floors.map((f, i) => (
                <li key={f.collectionHandle ?? i} className="adm-orderlist__item">
                  <span className="adm-orderlist__pos">{i + 1}</span>
                  <Thumb src={f.image ? imageSrc(f.image, 320) : null} size={44} />
                  <span className="adm-orderlist__title">
                    {f.name}
                    {f.line && <span className="adm-muted adm-small adm-block">{f.line}</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card title={cardTitle('boutique', named('boutique', 'The boutique'))}>
          <div className="adm-stack">
            <TextInput
              label="Title"
              optional
              value={draft.boutiqueHeading}
              maxLength={80}
              error={errors['boutique.heading']}
              placeholder={savedDropName}
              hint="Left empty, the section takes the name of the featured collection. Wrap words in *asterisks* for italics."
              onChange={(e) => set('boutiqueHeading', e.target.value)}
            />
            <Textarea
              label="Subtitle"
              optional
              rows={2}
              maxLength={240}
              value={draft.boutiqueIntro}
              error={errors['boutique.intro']}
              hint="Shown under the title. The pieces themselves come from the featured collection, under Settings."
              onChange={(e) => set('boutiqueIntro', e.target.value)}
            />
          </div>
        </Card>

        <Card title={cardTitle('accessories', accessoriesName)}>
          <div className="adm-stack">
            <TextInput
              label="Title"
              value={draft.accessoriesHeading}
              maxLength={80}
              error={errors['accessories.heading']}
              hint="Wrap words in *asterisks* to set them in italics."
              onChange={(e) => set('accessoriesHeading', e.target.value)}
            />
            <Textarea
              label="Subtitle"
              optional
              rows={2}
              maxLength={240}
              value={draft.accessoriesIntro}
              error={errors['accessories.intro']}
              hint="Shown under the title."
              onChange={(e) => set('accessoriesIntro', e.target.value)}
            />
          </div>
        </Card>

        <Card title="The look book">
          <div className="adm-stack">
            <p className="adm-field__hint">
              The house's photographs on their own — no piece, no price. They run as a swipe-through on the home page, between {accessoriesName} and Limited edition, and open in full from the “View the look book” button. While none are set, the shop shows its own set.
            </p>
            <div className="adm-grid adm-grid--2">
              <TextInput
                label="Heading"
                value={draft.lookbookHeading}
                maxLength={80}
                error={errors['lookbook.heading']}
                hint="Wrap words in *asterisks* to set them in italics."
                onChange={(e) => set('lookbookHeading', e.target.value)}
              />
              <TextInput
                label="Line beside it"
                optional
                value={draft.lookbookIntro}
                maxLength={240}
                error={errors['lookbook.intro']}
                onChange={(e) => set('lookbookIntro', e.target.value)}
              />
            </div>
            {draft.lookbook.length > 0 && (
              <ul className="adm-mediagrid">
                {draft.lookbook.map((m, i) => (
                  <li key={m.id} className="adm-mediagrid__item">
                    <img decoding="async" src={imageSrc(m, 320)} alt={m.alt} loading="lazy" />
                    {errors[`lookbook.images.${i}`] && <span className="adm-mediagrid__warn">{errors[`lookbook.images.${i}`]}</span>}
                    <div className="adm-mediagrid__tools">
                      <IconButton label={`Move look ${i + 1} earlier`} disabled={i === 0} onClick={() => set('lookbook', moveItem(draft.lookbook, i, i - 1))}>
                        <IconChevronLeft size={14} />
                      </IconButton>
                      <IconButton
                        label={`Move look ${i + 1} later`}
                        disabled={i === draft.lookbook.length - 1}
                        onClick={() => set('lookbook', moveItem(draft.lookbook, i, i + 1))}
                      >
                        <IconChevronRight size={14} />
                      </IconButton>
                      <IconButton label={`Remove look ${i + 1}`} tone="danger" onClick={() => set('lookbook', draft.lookbook.filter((x) => x.id !== m.id))}>
                        <IconTrash size={14} />
                      </IconButton>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {draft.lookbook.length < MAX_LOOKBOOK && (
              <ImageUploader onUploaded={(items) => set('lookbook', [...draft.lookbook, ...items])} />
            )}
          </div>
        </Card>

        <Card title={cardTitle('journal', named('journal', 'Limited edition'))}>
          <div className="adm-stack">
            <TextInput
              label="Heading"
              value={draft.journalHeading}
              maxLength={80}
              error={errors['journal.heading']}
              hint="Wrap words in *asterisks* to set them in italics."
              onChange={(e) => set('journalHeading', e.target.value)}
            />
            <Textarea
              label="Words"
              rows={4}
              maxLength={600}
              value={draft.journalIntro}
              error={errors['journal.intro']}
              hint="The paragraph beside the pieces."
              onChange={(e) => set('journalIntro', e.target.value)}
            />
            <TextInput
              label="Button"
              value={draft.journalButton}
              maxLength={40}
              error={errors['journal.buttonLabel']}
              hint="The button under the words; it goes to Where to find us."
              onChange={(e) => set('journalButton', e.target.value)}
            />
            <SiteFileField
              label="The notebook"
              kind="pdf"
              value={draft.notebook}
              error={errors['journal.notebookMediaId']}
              hint="A PDF — the lookbook, a catalogue, a price list. A second button appears beside the first and downloads it; with nothing uploaded, no button shows."
              onChange={(notebook) => set('notebook', notebook)}
            />
          </div>
        </Card>

        <Card
          title={cardTitle('popups', named('popups', 'Where to find us'))}
          actions={
            draft.popups.length < MAX_POPUPS ? (
              <Button size="sm" icon={<IconPlus size={14} />} onClick={addPopUp}>
                Add a pop-up
              </Button>
            ) : undefined
          }
        >
          <div className="adm-stack">
            <div className="adm-grid adm-grid--2">
              <TextInput
                label="Heading"
                value={draft.popupsHeading}
                maxLength={80}
                error={errors['popups.heading']}
                hint="Wrap words in *asterisks* for italics."
                onChange={(e) => set('popupsHeading', e.target.value)}
              />
              <TextInput
                label="Line beside it"
                optional
                value={draft.popupsIntro}
                maxLength={200}
                error={errors['popups.intro']}
                onChange={(e) => set('popupsIntro', e.target.value)}
              />
            </div>

            {draft.popups.length === 0 ? (
              <p className="adm-muted">No pop-ups listed. The section shows its heading and nothing under it.</p>
            ) : (
              <ol className="adm-poprows">
                {draft.popups.map((r, i) => {
                  const title = r.place || `pop-up ${i + 1}`;
                  return (
                    <li key={r.key} className="adm-poprow">
                      <span className="adm-orderlist__pos">{String(i + 1).padStart(2, '0')}</span>
                      <TextInput
                        label={`Pop-up ${i + 1} place`}
                        labelHidden
                        placeholder="Beit Misk"
                        value={r.place}
                        maxLength={60}
                        error={errors[`popups.rows.${i}.place`]}
                        onChange={(e) => setPopUp(r.key, { place: e.target.value })}
                      />
                      <TextInput
                        label={`${title} city`}
                        labelHidden
                        placeholder="Mount Lebanon"
                        value={r.city}
                        maxLength={60}
                        onChange={(e) => setPopUp(r.key, { city: e.target.value })}
                      />
                      <TextInput
                        label={`${title} dates`}
                        labelHidden
                        placeholder="04 — 06 September"
                        value={r.dates}
                        maxLength={60}
                        onChange={(e) => setPopUp(r.key, { dates: e.target.value })}
                      />
                      <TextInput
                        label={`${title} time`}
                        labelHidden
                        placeholder="From 16:00"
                        value={r.time}
                        maxLength={40}
                        onChange={(e) => setPopUp(r.key, { time: e.target.value })}
                      />
                      <Select
                        label={`${title} status`}
                        labelHidden
                        value={r.status}
                        onChange={(e) => setPopUp(r.key, { status: e.target.value as PopUpDTO['status'] })}
                      >
                        <option value="open">On</option>
                        <option value="past">Past</option>
                      </Select>
                      <span className="adm-row adm-row--tight">
                        <IconButton label={`Move ${title} up`} disabled={i === 0} onClick={() => set('popups', moveItem(draft.popups, i, i - 1))}>
                          <IconArrowUp size={14} />
                        </IconButton>
                        <IconButton
                          label={`Move ${title} down`}
                          disabled={i === draft.popups.length - 1}
                          onClick={() => set('popups', moveItem(draft.popups, i, i + 1))}
                        >
                          <IconArrowDown size={14} />
                        </IconButton>
                        <IconButton label={`Remove ${title}`} tone="danger" onClick={() => set('popups', draft.popups.filter((x) => x.key !== r.key))}>
                          <IconTrash size={14} />
                        </IconButton>
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </Card>

        <Card title="The footer">
          <div className="adm-stack">
            <Textarea
              label="About the house"
              rows={3}
              maxLength={400}
              value={draft.footerBlurb}
              error={errors['footer.blurb']}
              hint="The paragraph under the house's name, bottom left."
              onChange={(e) => set('footerBlurb', e.target.value)}
            />
            <TextInput
              label="Client care note"
              optional
              value={draft.footerCare}
              maxLength={200}
              error={errors['footer.careNote']}
              hint="The last line of the Client care column, e.g. the exchange window."
              onChange={(e) => set('footerCare', e.target.value)}
            />
            <p className="adm-field__hint">
              The footer's links are your collections (Settings → Category menu), your policy pages (Pages), and the contact details under Settings.
            </p>
          </div>
        </Card>
      </div>

      <SaveBar dirty={dirty} saving={save.isPending} onSave={submit} onDiscard={() => { setDraft(base); setErrors({}); }} />
    </>
  );
}
