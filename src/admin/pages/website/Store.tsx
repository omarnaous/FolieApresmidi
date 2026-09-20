import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ORDER_EMAIL_TOKENS, post, put, SettingsInput, SIZE_CHART_MAX_COLUMNS, SIZE_CHART_MAX_ROWS, type MediaDTO, type OrderEmailDTO, type SettingsDTO } from '../../lib/contract';
import { apiFieldErrors, validate, type FieldErrors } from '../../lib/forms';
import { useUnsavedChanges } from '../../lib/hooks';
import { qk, usePublicCollections, useSettings } from '../../lib/queries';
import { clientKey, sameJson } from '../../lib/util';
import { Button, IconButton, Spinner } from '../../ui/Button';
import { ErrorBanner, FormErrorSummary, QueryState } from '../../ui/feedback';
import { CollectionSelect } from '../../ui/CollectionSelect';
import { NumberInput, Textarea, TextInput, Toggle } from '../../ui/form';
import { IconPlus, IconTrash } from '../../ui/icons';
import { Card, PageHeader, SaveBar } from '../../ui/layout';
import { SingleImageField } from '../../ui/media';
import { useToast } from '../../ui/Toasts';
import { WebsiteTabs } from './Tabs';

/** The size chart, with keys so a row or column keeps its inputs while edited. */
interface ChartColumn {
  key: string;
  name: string;
}
interface ChartRow {
  key: string;
  size: string;
  values: string[];
}
interface ChartDraft {
  heading: string;
  intro: string;
  columns: ChartColumn[];
  rows: ChartRow[];
  note: string;
}

interface SettingsDraft {
  name: string;
  currency: string;
  contactEmail: string;
  contactPhone: string;
  instagram: string;
  address: string;
  logo: MediaDTO | null;
  featuredCollectionHandle: string;
  editorialCollectionHandle: string;
  lowStockThreshold: number | null;
  checkoutHoldMinutes: number | null;
  abandonedCartEmails: boolean;
  orderNotificationEmail: string;
  sizeChart: ChartDraft;
  orderEmail: { subject: string; intro: string; signoff: string };
}

const fromDTO = (s: SettingsDTO): SettingsDraft => ({
  name: s.name,
  currency: s.currency,
  contactEmail: s.contactEmail ?? '',
  contactPhone: s.contactPhone ?? '',
  instagram: s.instagram ?? '',
  address: s.address ?? '',
  logo: s.logo,
  featuredCollectionHandle: s.featuredCollectionHandle ?? '',
  editorialCollectionHandle: s.editorialCollectionHandle ?? '',
  lowStockThreshold: s.lowStockThreshold,
  checkoutHoldMinutes: s.checkoutHoldMinutes,
  abandonedCartEmails: s.abandonedCartEmails,
  orderNotificationEmail: s.orderNotificationEmail ?? '',
  orderEmail: { subject: s.orderEmail.subject, intro: s.orderEmail.intro, signoff: s.orderEmail.signoff ?? '' },
  sizeChart: {
    heading: s.sizeChart.heading,
    intro: s.sizeChart.intro ?? '',
    columns: s.sizeChart.columns.map((name) => ({ key: clientKey('c'), name })),
    rows: s.sizeChart.rows.map((r) => ({ key: clientKey('r'), size: r.size, values: [...r.values] })),
    note: s.sizeChart.note ?? '',
  },
});

export default function StorePage() {
  const q = useSettings();
  if (!q.data) {
    return (
      <>
        <PageHeader title="Website design" docTitle="Store details" />
        <WebsiteTabs />
        <QueryState error={q.error} isPending={q.isPending} onRetry={() => void q.refetch()} />
      </>
    );
  }
  return <StoreForm settings={q.data} />;
}

function StoreForm({ settings }: { settings: SettingsDTO }) {
  const qc = useQueryClient();
  const toast = useToast();
  const collections = usePublicCollections();
  const [base, setBase] = useState<SettingsDraft>(() => fromDTO(settings));
  const [draft, setDraft] = useState<SettingsDraft>(base);
  const [errors, setErrors] = useState<FieldErrors>({});
  const dirty = !sameJson(base, draft);
  useUnsavedChanges(dirty);
  const set = <K extends keyof SettingsDraft>(k: K, v: SettingsDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  /* The test goes to the address that is saved, not the one being typed —
     so it is only offered once the two are the same. */
  const alertsTo = base.orderNotificationEmail.trim();
  const alertsChanged = draft.orderNotificationEmail.trim() !== alertsTo;
  const test = useMutation({
    mutationFn: () => post<void>('/api/admin/settings/order-email/test'),
    onSuccess: () => toast.success(`Sent to ${alertsTo}`),
    onError: (err) => setErrors(apiFieldErrors(err)),
  });

  const save = useMutation({
    mutationFn: (body: SettingsInput) => put<SettingsDTO>('/api/admin/settings', body),
    onSuccess: (dto) => {
      qc.setQueryData(qk.settings, dto);
      void qc.invalidateQueries({ queryKey: qk.store });
      const next = fromDTO(dto);
      setBase(next);
      setDraft(next);
      setErrors({});
      toast.success('The store was saved');
    },
    onError: (err) => setErrors(apiFieldErrors(err)),
  });

  const submit = () => {
    if (save.isPending) return;
    const errs: FieldErrors = {};
    if (draft.lowStockThreshold === null) errs.lowStockThreshold = 'Enter a number';
    if (draft.checkoutHoldMinutes === null) errs.checkoutHoldMinutes = 'Enter a number of minutes';
    const body: SettingsInput = {
      name: draft.name,
      currency: draft.currency,
      contactEmail: draft.contactEmail.trim() || null,
      contactPhone: draft.contactPhone.trim() || null,
      instagram: draft.instagram.trim().replace(/^@/, '') || null,
      address: draft.address.trim() || null,
      logoMediaId: draft.logo?.id ?? null,
      featuredCollectionHandle: draft.featuredCollectionHandle || null,
      // the lookbook section is gone; clearing the setting stops a stale
      // handle from failing the collection check on every save
      lookbookCollectionHandle: null,
      editorialCollectionHandle: draft.editorialCollectionHandle || null,
      lowStockThreshold: draft.lowStockThreshold ?? 0,
      checkoutHoldMinutes: draft.checkoutHoldMinutes ?? 0,
      abandonedCartEmails: draft.abandonedCartEmails,
      orderNotificationEmail: draft.orderNotificationEmail.trim() || null,
      orderEmail: {
        subject: draft.orderEmail.subject,
        intro: draft.orderEmail.intro,
        signoff: draft.orderEmail.signoff.trim() || null,
      },
      sizeChart: {
        heading: draft.sizeChart.heading,
        intro: draft.sizeChart.intro.trim() || null,
        columns: draft.sizeChart.columns.map((c) => c.name),
        rows: draft.sizeChart.rows.map((r) => ({ size: r.size, values: r.values })),
        note: draft.sizeChart.note.trim() || null,
      },
    };
    const all = { ...(validate(SettingsInput, body) ?? {}), ...errs };
    setErrors(all);
    if (Object.keys(all).length) return window.scrollTo({ top: 0 });
    save.mutate(body);
  };

  const options = collections.data?.items ?? [];
  const failed = !!collections.error;

  return (
    <>
      <PageHeader title="Website design" docTitle="Store details" />
      <WebsiteTabs />
      <FormErrorSummary errors={save.error ? {} : errors} />
      <ErrorBanner error={save.error} title="The store was not saved" />

      <div className="adm-split">
        <div className="adm-split__main">
          <Card title="Store details">
            <div className="adm-stack">
              <div className="adm-grid adm-grid--2">
                <TextInput label="Store name" value={draft.name} maxLength={120} error={errors.name} onChange={(e) => set('name', e.target.value)} />
                <TextInput
                  label="Currency"
                  value={draft.currency}
                  maxLength={3}
                  error={errors.currency}
                  hint="3-letter code, e.g. USD. Changing it does not convert existing prices."
                  onChange={(e) => set('currency', e.target.value.toUpperCase())}
                />
              </div>
              <Textarea label="Address" optional rows={3} maxLength={500} value={draft.address} error={errors.address} hint="Shown on receipts and the contact page." onChange={(e) => set('address', e.target.value)} />
            </div>
          </Card>

          <Card title="Contact">
            <div className="adm-grid adm-grid--2">
              <TextInput label="Contact email" optional type="email" value={draft.contactEmail} error={errors.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} />
              <TextInput label="Contact phone" optional type="tel" value={draft.contactPhone} maxLength={40} error={errors.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} />
              <TextInput label="Instagram" optional prefix="@" value={draft.instagram} maxLength={60} error={errors.instagram} onChange={(e) => set('instagram', e.target.value)} />
            </div>
          </Card>

          <Card
            title="Order emails"
            actions={
              <Button size="sm" disabled={!alertsTo || alertsChanged || test.isPending} onClick={() => test.mutate()}>
                {test.isPending ? <Spinner label="Sending" /> : 'Send a test'}
              </Button>
            }
          >
            <div className="adm-stack">
              <TextInput
                label="Send new orders to"
                optional
                type="email"
                value={draft.orderNotificationEmail}
                error={errors.orderNotificationEmail}
                hint="Every order placed on the shop is emailed here the moment it is placed — what was bought, who it is for, and a link straight to it."
                onChange={(e) => set('orderNotificationEmail', e.target.value)}
              />
              <p className="adm-field__hint">
                {alertsChanged
                  ? 'Save, and you can send a test to that address.'
                  : alertsTo
                    ? `New orders are going to ${alertsTo}.`
                    : 'While this is empty no order email is sent — orders still arrive under Orders.'}
              </p>
            </div>
          </Card>

          {/* what the buyer reads. The shop supplies what was bought and what
              it cost; these are the words around it. */}
          <OrderEmailCard
            copy={draft.orderEmail}
            errors={errors}
            onChange={(orderEmail) => set('orderEmail', orderEmail)}
          />

          <Card title="Home page collections">
            <div className="adm-grid adm-grid--3">
              <CollectionSelect options={options} failed={failed} label="Featured" value={draft.featuredCollectionHandle} emptyLabel="None" error={errors.featuredCollectionHandle} onChange={(v) => set('featuredCollectionHandle', v)} />
              <CollectionSelect options={options} failed={failed} label="Editorial" value={draft.editorialCollectionHandle} emptyLabel="None" error={errors.editorialCollectionHandle} onChange={(v) => set('editorialCollectionHandle', v)} />
            </div>
          </Card>

          <SizeChartCard chart={draft.sizeChart} errors={errors} onChange={(sizeChart) => set('sizeChart', sizeChart)} />
        </div>

        <div className="adm-split__side">
          <Card title="Logo">
            <SingleImageField label="Store logo" value={draft.logo} onChange={(m) => set('logo', m)} />
            {errors.logoMediaId && <p className="adm-field__error">{errors.logoMediaId}</p>}
          </Card>
          <Card title="Checkout & inventory">
            <div className="adm-stack">
              <NumberInput label="Low-stock threshold" min={0} max={1000} value={draft.lowStockThreshold} error={errors.lowStockThreshold} hint="Variants at or below this show as low stock." onChange={(v) => set('lowStockThreshold', v)} />
              <NumberInput
                label="Checkout stock hold"
                suffix="min"
                min={0}
                max={120}
                value={draft.checkoutHoldMinutes}
                error={errors.checkoutHoldMinutes}
                hint="How long items stay reserved while a customer checks out."
                onChange={(v) => set('checkoutHoldMinutes', v)}
              />
              <Toggle label="Abandoned cart emails" hint="Remind customers who left items in checkout." checked={draft.abandonedCartEmails} onChange={(v) => set('abandonedCartEmails', v)} />
            </div>
          </Card>
        </div>
      </div>

      <SaveBar dirty={dirty} saving={save.isPending} onSave={submit} onDiscard={() => { setDraft(base); setErrors({}); }} />
    </>
  );
}

/**
 * One size chart for the shop, shown on every product that has sizes. The
 * measurements are the columns and the sizes are the rows; a size with no
 * numbers in it, or a measurement left blank throughout, is left off the
 * product page rather than shown as a gap.
 */
function SizeChartCard({ chart, errors, onChange }: { chart: ChartDraft; errors: FieldErrors; onChange: (next: ChartDraft) => void }) {
  const set = <K extends keyof ChartDraft>(k: K, v: ChartDraft[K]) => onChange({ ...chart, [k]: v });
  const filled = chart.rows.some((r) => r.size.trim() && r.values.some((v) => v.trim()));

  const setColumn = (i: number, name: string) => set('columns', chart.columns.map((c, j) => (j === i ? { ...c, name } : c)));
  const addColumn = () =>
    onChange({
      ...chart,
      columns: [...chart.columns, { key: clientKey('c'), name: '' }],
      rows: chart.rows.map((r) => ({ ...r, values: [...r.values, ''] })),
    });
  const removeColumn = (i: number) =>
    onChange({
      ...chart,
      columns: chart.columns.filter((_, j) => j !== i),
      rows: chart.rows.map((r) => ({ ...r, values: r.values.filter((_, j) => j !== i) })),
    });

  const setRow = (key: string, patch: Partial<ChartRow>) => set('rows', chart.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const setCell = (key: string, i: number, value: string) =>
    set('rows', chart.rows.map((r) => (r.key === key ? { ...r, values: r.values.map((v, j) => (j === i ? value : v)) } : r)));
  const addRow = () => set('rows', [...chart.rows, { key: clientKey('r'), size: '', values: chart.columns.map(() => '') }]);

  return (
    <Card
      title="Size chart"
      actions={
        chart.rows.length < SIZE_CHART_MAX_ROWS ? (
          <Button size="sm" icon={<IconPlus size={14} />} onClick={addRow}>
            Add size
          </Button>
        ) : undefined
      }
    >
      <div className="adm-stack">
        <p className="adm-field__hint">
          {filled
            ? 'Shown on every product that has sizes, behind a link next to the size buttons.'
            : 'Fill in some measurements to show this on the product pages. Until then, no chart appears.'}
        </p>
        <div className="adm-grid adm-grid--2">
          <TextInput label="Heading" value={chart.heading} maxLength={60} error={errors['sizeChart.heading']} onChange={(e) => set('heading', e.target.value)} />
          <TextInput
            label="Line under the heading"
            optional
            value={chart.intro}
            maxLength={200}
            error={errors['sizeChart.intro']}
            hint="Say how the pieces are measured, e.g. laid flat, in centimetres."
            onChange={(e) => set('intro', e.target.value)}
          />
        </div>

        <div className="adm-field">
          <div className="adm-field__top">
            <span className="adm-field__label">Measurements</span>
            {chart.columns.length < SIZE_CHART_MAX_COLUMNS && (
              <Button size="sm" variant="link" onClick={addColumn}>
                Add measurement
              </Button>
            )}
          </div>
          {chart.columns.length === 0 ? (
            <p className="adm-muted">No measurements yet.</p>
          ) : (
            <div className="adm-chart-cols">
              {chart.columns.map((c, i) => (
                <span className="adm-chart-col" key={c.key}>
                  <TextInput
                    label={`Measurement ${i + 1}`}
                    labelHidden
                    placeholder="Bust"
                    value={c.name}
                    maxLength={24}
                    error={errors[`sizeChart.columns.${i}`]}
                    onChange={(e) => setColumn(i, e.target.value)}
                  />
                  <IconButton label={`Remove ${c.name || `measurement ${i + 1}`}`} tone="danger" onClick={() => removeColumn(i)}>
                    <IconTrash size={14} />
                  </IconButton>
                </span>
              ))}
            </div>
          )}
        </div>

        {chart.rows.length === 0 ? (
          <p className="adm-muted">No sizes yet.</p>
        ) : (
          <div className="adm-chart-scroll">
            <table className="adm-chart">
              <thead>
                <tr>
                  <th scope="col">Size</th>
                  {chart.columns.map((c, i) => (
                    <th scope="col" key={c.key}>{c.name.trim() || `Measurement ${i + 1}`}</th>
                  ))}
                  <th scope="col"><span className="adm-sr">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {chart.rows.map((r, i) => (
                  <tr key={r.key}>
                    <td>
                      <TextInput
                        label={`Size ${i + 1}`}
                        labelHidden
                        placeholder="Small"
                        value={r.size}
                        maxLength={24}
                        error={errors[`sizeChart.rows.${i}.size`]}
                        onChange={(e) => setRow(r.key, { size: e.target.value })}
                      />
                    </td>
                    {chart.columns.map((c, j) => (
                      <td key={c.key}>
                        <TextInput
                          label={`${r.size || `size ${i + 1}`} ${c.name || `measurement ${j + 1}`}`}
                          labelHidden
                          value={r.values[j] ?? ''}
                          maxLength={24}
                          onChange={(e) => setCell(r.key, j, e.target.value)}
                        />
                      </td>
                    ))}
                    <td>
                      <IconButton label={`Remove ${r.size || `size ${i + 1}`}`} tone="danger" onClick={() => set('rows', chart.rows.filter((x) => x.key !== r.key))}>
                        <IconTrash size={14} />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <TextInput
          label="Line under the table"
          optional
          value={chart.note}
          maxLength={200}
          error={errors['sizeChart.note']}
          hint="For anything else worth saying, e.g. that pieces are made in small runs and vary slightly."
          onChange={(e) => set('note', e.target.value)}
        />
      </div>
    </Card>
  );
}

/**
 * The confirmation a buyer is sent, in the owner's own words. Only the three
 * places a letter needs are theirs — the subject, the line above the order,
 * and the sign-off. What was bought, what it cost and where it is going are
 * the shop's to print, so no amount of editing can send an order out with
 * its own details missing.
 */
function OrderEmailCard({
  copy,
  errors,
  onChange,
}: {
  copy: { subject: string; intro: string; signoff: string };
  errors: FieldErrors;
  onChange: (next: { subject: string; intro: string; signoff: string }) => void;
}) {
  const set = (k: keyof typeof copy, v: string) => onChange({ ...copy, [k]: v });
  // what the buyer of a $150 order from Léa would actually read
  const shown = (text: string) =>
    text.replaceAll('{{order}}', '#1004').replaceAll('{{name}}', 'Léa').replaceAll('{{total}}', '$150');

  return (
    <Card title="The email a buyer is sent">
      <div className="adm-stack">
        <p className="adm-field__hint">
          Sent the moment an order is placed. {ORDER_EMAIL_TOKENS.join(', ')} stand in for the order number, the buyer's first name and
          what they paid.
        </p>
        <TextInput
          label="Subject"
          value={copy.subject}
          maxLength={120}
          error={errors['orderEmail.subject']}
          onChange={(e) => set('subject', e.target.value)}
        />
        <Textarea
          label="What it says first"
          rows={3}
          maxLength={600}
          value={copy.intro}
          error={errors['orderEmail.intro']}
          hint="Printed above the list of what they bought."
          onChange={(e) => set('intro', e.target.value)}
        />
        <Textarea
          label="How it signs off"
          optional
          rows={2}
          maxLength={400}
          value={copy.signoff}
          error={errors['orderEmail.signoff']}
          hint="Printed under the order. Leave it empty for none."
          onChange={(e) => set('signoff', e.target.value)}
        />

        <div className="adm-field">
          <span className="adm-field__label">As a buyer reads it</span>
          <div className="adm-preview">
            <p className="adm-preview__subject">{shown(copy.subject) || 'No subject'}</p>
            <p>{shown(copy.intro)}</p>
            <p className="adm-preview__rows">1 × La chaleur qui reste — $150<br />Total $150</p>
            {copy.signoff.trim() && <p>{shown(copy.signoff)}</p>}
          </div>
        </div>
      </div>
    </Card>
  );
}
