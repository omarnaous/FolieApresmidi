import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import {
  del,
  formatMoney,
  post,
  put,
  SHIPPING_RATE_TYPES,
  ShippingRateInput,
  ShippingZoneInput,
  type ShippingRateDTO,
  type ShippingRateType,
  type ShippingZoneDTO,
} from '../lib/contract';
import { apiFieldErrors, validate, type FieldErrors } from '../lib/forms';
import { countryName } from '../lib/format';
import { qk, useShippingZones, useStore } from '../lib/queries';
import { clientKey } from '../lib/util';
import { Button, IconButton } from '../ui/Button';
import { Badge, EmptyState, errorMessage, ErrorBanner, QueryState } from '../ui/feedback';
import { Checkbox, ChoiceGroup, MoneyInput, NumberInput, TextInput, Toggle } from '../ui/form';
import { IconEdit, IconPlus, IconTrash } from '../ui/icons';
import { Card, PageHeader } from '../ui/layout';
import { ConfirmDialog, Modal } from '../ui/Modal';
import { DataTable } from '../ui/Table';
import { useToast } from '../ui/Toasts';

type ZonesCache = { items: ShippingZoneDTO[] };
type RateInput = { name: string; type: ShippingRateType; amount: number; minValue: number | null; maxValue: number | null; deliveryEstimate: string | null; active: boolean };

const TYPE_LABELS: Record<ShippingRateType, string> = { flat: 'Flat rate', weight: 'By weight', price: 'By order value' };
const kg = (g: number) => (g / 1000).toFixed(3).replace(/\.?0+$/, '');

export function conditionSummary(r: Pick<ShippingRateDTO, 'type' | 'minValue' | 'maxValue'>, currency: string): string {
  if (r.type === 'flat') return 'All orders';
  const { minValue: min, maxValue: max } = r;
  if (r.type === 'price') {
    const m = (v: number) => formatMoney(v, currency);
    if (min !== null && max !== null) return `Orders ${m(min)}–${m(max)}`;
    if (min !== null) return `Orders ${m(min)} and up`;
    if (max !== null) return `Orders up to ${m(max)}`;
    return 'Any order value';
  }
  if (min !== null && max !== null) return `${kg(min)}–${kg(max)} kg`;
  if (min !== null) return `${kg(min)} kg and up`;
  if (max !== null) return `Up to ${kg(max)} kg`;
  return 'Any weight';
}

const toRateInput = (r: ShippingRateDTO, patch: Partial<RateInput> = {}): RateInput => ({
  name: r.name,
  type: r.type,
  amount: r.amount,
  minValue: r.minValue,
  maxValue: r.maxValue,
  deliveryEstimate: r.deliveryEstimate,
  active: r.active,
  ...patch,
});

type Pending =
  | { kind: 'zone'; zone: ShippingZoneDTO | null }
  | { kind: 'rate'; zone: ShippingZoneDTO; rate: ShippingRateDTO | null }
  | { kind: 'delete-zone'; zone: ShippingZoneDTO }
  | { kind: 'delete-rate'; rate: ShippingRateDTO };

export default function ShippingPage() {
  const q = useShippingZones();
  const store = useStore();
  const qc = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = useState<Pending | null>(null);
  const currency = store.data?.currency;
  const close = () => setPending(null);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.shipping });
    void qc.invalidateQueries({ queryKey: qk.store });
  };

  const toggleRate = useMutation({
    mutationFn: ({ rate, active }: { rate: ShippingRateDTO; active: boolean }) => put<ShippingRateDTO>(`/api/admin/shipping/rates/${rate.id}`, toRateInput(rate, { active })),
    onMutate: async ({ rate, active }) => {
      await qc.cancelQueries({ queryKey: qk.shipping });
      const prev = qc.getQueryData<ZonesCache>(qk.shipping);
      if (prev) qc.setQueryData<ZonesCache>(qk.shipping, { items: prev.items.map((z) => ({ ...z, rates: z.rates.map((r) => (r.id === rate.id ? { ...r, active } : r)) })) });
      return { prev };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.shipping, ctx.prev);
      toast.error(errorMessage(err));
    },
    onSuccess: (_d, { active, rate }) => toast.success(`${rate.name} ${active ? 'enabled' : 'disabled'}`),
    onSettled: invalidate,
  });

  const remove = useMutation({
    mutationFn: (p: Pending) =>
      p.kind === 'delete-zone' ? del<void>(`/api/admin/shipping/zones/${p.zone.id}`) : p.kind === 'delete-rate' ? del<void>(`/api/admin/shipping/rates/${p.rate.id}`) : Promise.resolve(),
    onSuccess: (_d, p) => {
      invalidate();
      toast.success(p.kind === 'delete-zone' ? 'Zone deleted' : 'Rate deleted');
      close();
    },
  });

  const addZone = (
    <Button variant="primary" icon={<IconPlus size={15} />} onClick={() => setPending({ kind: 'zone', zone: null })}>
      Add zone
    </Button>
  );

  return (
    <>
      <PageHeader title="Shipping" actions={q.data?.length ? addZone : undefined} />
      {!q.data || !currency ? (
        <QueryState error={q.error ?? store.error} isPending onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <Card>
          <EmptyState title="No shipping zones" body="Create a zone for the countries you ship to, then add rates. Checkout only offers countries with a zone." action={addZone} />
        </Card>
      ) : (
        <div className="adm-stack">
          {q.data.map((zone) => (
            <Card
              key={zone.id}
              title={zone.name}
              flush
              actions={
                <>
                  <Button size="sm" icon={<IconPlus size={14} />} onClick={() => setPending({ kind: 'rate', zone, rate: null })}>
                    Add rate
                  </Button>
                  <IconButton label={`Edit zone ${zone.name}`} onClick={() => setPending({ kind: 'zone', zone })}>
                    <IconEdit />
                  </IconButton>
                  <IconButton label={`Delete zone ${zone.name}`} tone="danger" onClick={() => setPending({ kind: 'delete-zone', zone })}>
                    <IconTrash />
                  </IconButton>
                </>
              }
            >
              <ul className="adm-chiplist adm-card__pad" aria-label={`Regions in ${zone.name}`}>
                {zone.regions.map((r) => (
                  <li key={`${r.countryCode}-${r.regionCode ?? ''}`} className="adm-chip adm-chip--static" title={countryName(r.countryCode)}>
                    {r.countryCode}
                    {r.regionCode ? ` — ${r.regionCode}` : ''}
                  </li>
                ))}
              </ul>
              {zone.rates.length === 0 ? (
                <EmptyState compact title="No rates in this zone" body="Customers in these regions can't check out until you add a rate." />
              ) : (
                <DataTable
                  caption={`Rates for ${zone.name}`}
                  rows={zone.rates}
                  rowKey={(r) => r.id}
                  columns={[
                    { key: 'name', header: 'Rate', cell: (r) => <span className="adm-strong">{r.name}</span>, sort: (a, b) => a.name.localeCompare(b.name) },
                    { key: 'type', header: 'Type', cell: (r) => TYPE_LABELS[r.type] },
                    { key: 'cond', header: 'Conditions', cell: (r) => conditionSummary(r, currency) },
                    { key: 'amount', header: 'Price', align: 'right', cell: (r) => (r.amount === 0 ? <Badge tone="success">Free</Badge> : formatMoney(r.amount, currency)), sort: (a, b) => a.amount - b.amount },
                    { key: 'eta', header: 'Delivery', cell: (r) => r.deliveryEstimate ?? <span className="adm-muted">—</span> },
                    {
                      key: 'active',
                      header: 'Active',
                      cell: (r) => <Toggle label={`${r.name} active`} labelHidden checked={r.active} onChange={(active) => toggleRate.mutate({ rate: r, active })} />,
                    },
                    {
                      key: 'actions',
                      header: 'Actions',
                      hideHeader: true,
                      align: 'right',
                      cell: (r) => (
                        <span className="adm-row adm-row--tight adm-row--end">
                          <IconButton label={`Edit rate ${r.name}`} onClick={() => setPending({ kind: 'rate', zone, rate: r })}>
                            <IconEdit />
                          </IconButton>
                          <IconButton label={`Delete rate ${r.name}`} tone="danger" onClick={() => setPending({ kind: 'delete-rate', rate: r })}>
                            <IconTrash />
                          </IconButton>
                        </span>
                      ),
                    },
                  ]}
                />
              )}
            </Card>
          ))}
        </div>
      )}

      {pending?.kind === 'zone' && <ZoneModal zone={pending.zone} onClose={close} onSaved={invalidate} />}
      {pending?.kind === 'rate' && currency && <RateModal zone={pending.zone} rate={pending.rate} currency={currency} onClose={close} onSaved={invalidate} />}
      <ConfirmDialog
        open={pending?.kind === 'delete-zone' || pending?.kind === 'delete-rate'}
        onClose={() => {
          close();
          remove.reset();
        }}
        title={pending?.kind === 'delete-zone' ? `Delete ${pending.zone.name}?` : pending?.kind === 'delete-rate' ? `Delete ${pending.rate.name}?` : ''}
        body={pending?.kind === 'delete-zone' ? 'The zone and all of its rates are removed. Customers in these regions will not be able to check out.' : 'This rate will no longer be offered at checkout.'}
        confirmLabel="Delete"
        tone="danger"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => pending && remove.mutate(pending)}
      />
    </>
  );
}

function ZoneModal({ zone, onClose, onSaved }: { zone: ShippingZoneDTO | null; onClose: () => void; onSaved: () => void }) {
  const formId = useId();
  const toast = useToast();
  const [name, setName] = useState(zone?.name ?? '');
  const [regions, setRegions] = useState(() =>
    (zone?.regions.length ? zone.regions : [{ countryCode: '', regionCode: null }]).map((r) => ({ key: clientKey('r'), countryCode: r.countryCode, regionCode: r.regionCode ?? '' })),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const save = useMutation({
    mutationFn: (body: { name: string; regions: { countryCode: string; regionCode: string | null }[] }) =>
      zone ? put<ShippingZoneDTO>(`/api/admin/shipping/zones/${zone.id}`, body) : post<ShippingZoneDTO>('/api/admin/shipping/zones', body),
    onSuccess: () => {
      onSaved();
      toast.success(zone ? 'Zone saved' : 'Zone created');
      onClose();
    },
    onError: (err) => setErrors(apiFieldErrors(err)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (save.isPending) return;
    const body = { name, regions: regions.map((r) => ({ countryCode: r.countryCode.trim().toUpperCase(), regionCode: r.regionCode.trim() || null })) };
    const invalid = validate(ShippingZoneInput, body);
    if (invalid) return setErrors(invalid);
    setErrors({});
    save.mutate(body);
  };
  const update = (key: string, patch: Partial<{ countryCode: string; regionCode: string }>) => setRegions((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <Modal
      open
      onClose={onClose}
      title={zone ? `Edit ${zone.name}` : 'Add shipping zone'}
      dismissible={!save.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={save.isPending}>
            {zone ? 'Save zone' : 'Create zone'}
          </Button>
        </>
      }
    >
      <form id={formId} className="adm-stack" onSubmit={submit} noValidate>
        <ErrorBanner error={save.error} />
        <TextInput label="Zone name" value={name} maxLength={80} error={errors.name} placeholder="Lebanon, GCC…" onChange={(e) => setName(e.target.value)} data-autofocus />
        <fieldset className="adm-regionrows">
          <legend className="adm-field__label">Regions</legend>
          <p className="adm-field__hint">A country code on its own covers the whole country; add a region to narrow it (e.g. AE — Dubai).</p>
          {regions.map((r, i) => (
            <div key={r.key} className="adm-regionrow">
              <TextInput
                label={`Country code ${i + 1}`}
                value={r.countryCode}
                maxLength={2}
                placeholder="LB"
                error={errors[`regions.${i}.countryCode`]}
                hint={r.countryCode.length === 2 ? countryName(r.countryCode) : undefined}
                onChange={(e) => update(r.key, { countryCode: e.target.value.toUpperCase() })}
              />
              <TextInput label={`Region ${i + 1}`} optional value={r.regionCode} maxLength={80} error={errors[`regions.${i}.regionCode`]} onChange={(e) => update(r.key, { regionCode: e.target.value })} />
              <IconButton label={`Remove region ${i + 1}`} tone="danger" disabled={regions.length === 1} onClick={() => setRegions((rs) => rs.filter((x) => x.key !== r.key))}>
                <IconTrash />
              </IconButton>
            </div>
          ))}
          {errors.regions && <p className="adm-field__error">{errors.regions}</p>}
          <div>
            <Button size="sm" icon={<IconPlus size={14} />} onClick={() => setRegions((rs) => [...rs, { key: clientKey('r'), countryCode: '', regionCode: '' }])}>
              Add country or region
            </Button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}

function RateModal({ zone, rate, currency, onClose, onSaved }: { zone: ShippingZoneDTO; rate: ShippingRateDTO | null; currency: string; onClose: () => void; onSaved: () => void }) {
  const formId = useId();
  const toast = useToast();
  const [draft, setDraft] = useState({
    name: rate?.name ?? '',
    type: rate?.type ?? ('flat' as ShippingRateType),
    amount: (rate?.amount ?? null) as number | null,
    minValue: rate?.minValue ?? null,
    maxValue: rate?.maxValue ?? null,
    deliveryEstimate: rate?.deliveryEstimate ?? '',
    active: rate?.active ?? true,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const save = useMutation({
    mutationFn: (body: RateInput) => (rate ? put<ShippingRateDTO>(`/api/admin/shipping/rates/${rate.id}`, body) : post<ShippingRateDTO>(`/api/admin/shipping/zones/${zone.id}/rates`, body)),
    onSuccess: () => {
      onSaved();
      toast.success(rate ? 'Rate saved' : 'Rate added');
      onClose();
    },
    onError: (err) => setErrors(apiFieldErrors(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (save.isPending) return;
    const errs: FieldErrors = {};
    if (draft.amount === null) errs.amount = 'Enter a price (0 for free)';
    const body: RateInput = {
      name: draft.name,
      type: draft.type,
      amount: draft.amount ?? 0,
      minValue: draft.type === 'flat' ? null : draft.minValue,
      maxValue: draft.type === 'flat' ? null : draft.maxValue,
      deliveryEstimate: draft.deliveryEstimate.trim() || null,
      active: draft.active,
    };
    const all = { ...(validate(ShippingRateInput, body) ?? {}), ...errs };
    if (Object.keys(all).length) return setErrors(all);
    setErrors({});
    save.mutate(body);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={rate ? `Edit ${rate.name}` : `Add rate to ${zone.name}`}
      dismissible={!save.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={save.isPending}>
            {rate ? 'Save rate' : 'Add rate'}
          </Button>
        </>
      }
    >
      <form id={formId} className="adm-stack" onSubmit={submit} noValidate>
        <ErrorBanner error={save.error} />
        <TextInput label="Rate name" value={draft.name} maxLength={80} error={errors.name} placeholder="Standard delivery" hint="Shown to customers at checkout." onChange={(e) => set('name', e.target.value)} data-autofocus />
        <ChoiceGroup
          label="Rate type"
          value={draft.type}
          onChange={(type) => setDraft((d) => ({ ...d, type, minValue: null, maxValue: null }))}
          options={SHIPPING_RATE_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }))}
        />
        <MoneyInput label="Price" currency={currency} value={draft.amount} error={errors.amount} hint="Enter 0 for free shipping." onChange={(v) => set('amount', v)} />
        {draft.type === 'price' && (
          <div className="adm-grid adm-grid--2">
            <MoneyInput label="Minimum order value" optional currency={currency} value={draft.minValue} error={errors.minValue} onChange={(v) => set('minValue', v)} />
            <MoneyInput label="Maximum order value" optional currency={currency} value={draft.maxValue} error={errors.maxValue} onChange={(v) => set('maxValue', v)} />
          </div>
        )}
        {draft.type === 'weight' && (
          <div className="adm-grid adm-grid--2">
            <NumberInput label="Minimum weight" optional suffix="g" min={0} value={draft.minValue} error={errors.minValue} onChange={(v) => set('minValue', v)} />
            <NumberInput label="Maximum weight" optional suffix="g" min={0} value={draft.maxValue} error={errors.maxValue} onChange={(v) => set('maxValue', v)} />
          </div>
        )}
        {draft.type !== 'flat' && <p className="adm-field__hint">Leave a bound empty for no limit. {draft.type === 'price' ? 'Order value is the subtotal after discounts.' : '1 kg = 1000 g.'}</p>}
        <TextInput label="Delivery estimate" optional value={draft.deliveryEstimate} maxLength={120} placeholder="2–4 business days" error={errors.deliveryEstimate} onChange={(e) => set('deliveryEstimate', e.target.value)} />
        <Checkbox label="Active" hint="Inactive rates are not offered at checkout." checked={draft.active} onChange={(v) => set('active', v)} />
      </form>
    </Modal>
  );
}
