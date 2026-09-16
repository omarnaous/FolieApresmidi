import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { put, SettingsInput, type MediaDTO, type SettingsDTO } from '../lib/contract';
import { apiFieldErrors, validate, type FieldErrors } from '../lib/forms';
import { useUnsavedChanges } from '../lib/hooks';
import { qk, usePublicCollections, useSettings } from '../lib/queries';
import { clientKey, moveItem, sameJson } from '../lib/util';
import { Button, IconButton } from '../ui/Button';
import { ErrorBanner, FormErrorSummary, QueryState } from '../ui/feedback';
import { NumberInput, Select, Textarea, TextInput, Toggle } from '../ui/form';
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from '../ui/icons';
import { Card, PageHeader, SaveBar } from '../ui/layout';
import { SingleImageField } from '../ui/media';
import { useToast } from '../ui/Toasts';

interface MenuRow {
  key: string;
  label: string;
  collectionHandle: string | null;
}

interface SettingsDraft {
  name: string;
  currency: string;
  contactEmail: string;
  contactPhone: string;
  instagram: string;
  address: string;
  logo: MediaDTO | null;
  menu: MenuRow[];
  featuredCollectionHandle: string;
  lookbookCollectionHandle: string;
  editorialCollectionHandle: string;
  lowStockThreshold: number | null;
  checkoutHoldMinutes: number | null;
  abandonedCartEmails: boolean;
  orderNotificationEmail: string;
}

const fromDTO = (s: SettingsDTO): SettingsDraft => ({
  name: s.name,
  currency: s.currency,
  contactEmail: s.contactEmail ?? '',
  contactPhone: s.contactPhone ?? '',
  instagram: s.instagram ?? '',
  address: s.address ?? '',
  logo: s.logo,
  menu: s.menu.map((m) => ({ key: clientKey('m'), label: m.label, collectionHandle: m.collectionHandle })),
  featuredCollectionHandle: s.featuredCollectionHandle ?? '',
  lookbookCollectionHandle: s.lookbookCollectionHandle ?? '',
  editorialCollectionHandle: s.editorialCollectionHandle ?? '',
  lowStockThreshold: s.lowStockThreshold,
  checkoutHoldMinutes: s.checkoutHoldMinutes,
  abandonedCartEmails: s.abandonedCartEmails,
  orderNotificationEmail: s.orderNotificationEmail ?? '',
});

export default function SettingsPage() {
  const q = useSettings();
  if (!q.data) {
    return (
      <>
        <PageHeader title="Settings" />
        <QueryState error={q.error} isPending={q.isPending} onRetry={() => void q.refetch()} />
      </>
    );
  }
  return <SettingsForm settings={q.data} />;
}

function SettingsForm({ settings }: { settings: SettingsDTO }) {
  const qc = useQueryClient();
  const toast = useToast();
  const collections = usePublicCollections();
  const [base, setBase] = useState<SettingsDraft>(() => fromDTO(settings));
  const [draft, setDraft] = useState<SettingsDraft>(base);
  const [errors, setErrors] = useState<FieldErrors>({});
  const dirty = !sameJson(base, draft);
  useUnsavedChanges(dirty);
  const set = <K extends keyof SettingsDraft>(k: K, v: SettingsDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setRow = (key: string, patch: Partial<MenuRow>) => set('menu', draft.menu.map((m) => (m.key === key ? { ...m, ...patch } : m)));

  const save = useMutation({
    mutationFn: (body: SettingsInput) => put<SettingsDTO>('/api/admin/settings', body),
    onSuccess: (dto) => {
      qc.setQueryData(qk.settings, dto);
      void qc.invalidateQueries({ queryKey: qk.store });
      const next = fromDTO(dto);
      setBase(next);
      setDraft(next);
      setErrors({});
      toast.success('Settings saved');
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
      menu: draft.menu.map((m) => ({ label: m.label, collectionHandle: m.collectionHandle })),
      featuredCollectionHandle: draft.featuredCollectionHandle || null,
      lookbookCollectionHandle: draft.lookbookCollectionHandle || null,
      editorialCollectionHandle: draft.editorialCollectionHandle || null,
      lowStockThreshold: draft.lowStockThreshold ?? 0,
      checkoutHoldMinutes: draft.checkoutHoldMinutes ?? 0,
      abandonedCartEmails: draft.abandonedCartEmails,
      orderNotificationEmail: draft.orderNotificationEmail.trim() || null,
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
      <PageHeader title="Settings" />
      <FormErrorSummary errors={save.error ? {} : errors} />
      <ErrorBanner error={save.error} title="Settings were not saved" />

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
            title="Category menu"
            actions={
              draft.menu.length < 20 ? (
                <Button size="sm" icon={<IconPlus size={14} />} onClick={() => set('menu', [...draft.menu, { key: clientKey('m'), label: '', collectionHandle: null }])}>
                  Add item
                </Button>
              ) : undefined
            }
          >
            <p className="adm-field__hint">The category chips across the top of the shop, in order.</p>
            {draft.menu.length === 0 ? (
              <p className="adm-muted adm-gap-top">No menu items yet.</p>
            ) : (
              <ol className="adm-menurows">
                {draft.menu.map((m, i) => (
                  <li key={m.key} className="adm-menurow">
                    <span className="adm-orderlist__pos">{i + 1}</span>
                    <TextInput label={`Item ${i + 1} label`} labelHidden placeholder="Label" value={m.label} maxLength={40} error={errors[`menu.${i}.label`]} onChange={(e) => setRow(m.key, { label: e.target.value })} />
                    <CollectionSelect options={options} failed={failed}
                      label={`Item ${i + 1} collection`}
                      value={m.collectionHandle ?? ''}
                      emptyLabel="All products"
                      error={errors[`menu.${i}.collectionHandle`]}
                      onChange={(v) => setRow(m.key, { collectionHandle: v || null })}
                    />
                    <span className="adm-row adm-row--tight">
                      <IconButton label={`Move ${m.label || `item ${i + 1}`} up`} disabled={i === 0} onClick={() => set('menu', moveItem(draft.menu, i, i - 1))}>
                        <IconArrowUp size={14} />
                      </IconButton>
                      <IconButton label={`Move ${m.label || `item ${i + 1}`} down`} disabled={i === draft.menu.length - 1} onClick={() => set('menu', moveItem(draft.menu, i, i + 1))}>
                        <IconArrowDown size={14} />
                      </IconButton>
                      <IconButton label={`Remove ${m.label || `item ${i + 1}`}`} tone="danger" onClick={() => set('menu', draft.menu.filter((x) => x.key !== m.key))}>
                        <IconTrash size={14} />
                      </IconButton>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card title="Home page collections">
            <div className="adm-grid adm-grid--3">
              <CollectionSelect options={options} failed={failed} label="Featured" value={draft.featuredCollectionHandle} emptyLabel="None" error={errors.featuredCollectionHandle} onChange={(v) => set('featuredCollectionHandle', v)} />
              <CollectionSelect options={options} failed={failed} label="Lookbook" value={draft.lookbookCollectionHandle} emptyLabel="None" error={errors.lookbookCollectionHandle} onChange={(v) => set('lookbookCollectionHandle', v)} />
              <CollectionSelect options={options} failed={failed} label="Editorial" value={draft.editorialCollectionHandle} emptyLabel="None" error={errors.editorialCollectionHandle} onChange={(v) => set('editorialCollectionHandle', v)} />
            </div>
          </Card>
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
          <Card title="Notifications">
            <TextInput
              label="New order email"
              optional
              type="email"
              value={draft.orderNotificationEmail}
              error={errors.orderNotificationEmail}
              hint="Where new order alerts are sent."
              onChange={(e) => set('orderNotificationEmail', e.target.value)}
            />
          </Card>
        </div>
      </div>

      <SaveBar dirty={dirty} saving={save.isPending} onSave={submit} onDiscard={() => { setDraft(base); setErrors({}); }} />
    </>
  );
}

/** Collection handle picker; falls back to a text input if collections can't load. */
function CollectionSelect({
  options,
  failed,
  label,
  value,
  onChange,
  error,
  emptyLabel,
}: {
  options: { id: string; handle: string; title: string }[];
  failed: boolean;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  emptyLabel: string;
}) {
  if (failed) {
    return <TextInput label={label} value={value} error={error} hint="Collection handle (collections could not be loaded)." onChange={(e) => onChange(e.target.value)} />;
  }
  const known = options.some((c) => c.handle === value);
  return (
    <Select label={label} value={value} error={error} onChange={(e) => onChange(e.target.value)}>
      <option value="">{emptyLabel}</option>
      {value && !known && <option value={value}>{value} (not published)</option>}
      {options.map((c) => (
        <option key={c.id} value={c.handle}>
          {c.title}
        </option>
      ))}
    </Select>
  );
}
