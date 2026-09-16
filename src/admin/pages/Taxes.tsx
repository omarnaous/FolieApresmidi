import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { del, formatRate, post, put, TaxRateInput, type TaxRateDTO, type TaxSettingsDTO } from '../lib/contract';
import { apiFieldErrors, validate, type FieldErrors } from '../lib/forms';
import { countryName } from '../lib/format';
import { qk, useTaxes } from '../lib/queries';
import { Button, IconButton } from '../ui/Button';
import { EmptyState, errorMessage, ErrorBanner, QueryState } from '../ui/feedback';
import { Checkbox, PercentInput, TextInput, Toggle } from '../ui/form';
import { IconEdit, IconPlus, IconTrash } from '../ui/icons';
import { Card, PageHeader } from '../ui/layout';
import { ConfirmDialog, Modal } from '../ui/Modal';
import { DataTable } from '../ui/Table';
import { useToast } from '../ui/Toasts';

type RateBody = { countryCode: string; regionCode: string | null; name: string; rateBps: number; appliesToShipping: boolean; active: boolean };
const toBody = (r: TaxRateDTO, patch: Partial<RateBody> = {}): RateBody => ({
  countryCode: r.countryCode,
  regionCode: r.regionCode,
  name: r.name,
  rateBps: r.rateBps,
  appliesToShipping: r.appliesToShipping,
  active: r.active,
  ...patch,
});

export default function TaxesPage() {
  const q = useTaxes();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<TaxRateDTO | 'new' | null>(null);
  const [deleting, setDeleting] = useState<TaxRateDTO | null>(null);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.taxes });
    void qc.invalidateQueries({ queryKey: qk.store });
    void qc.invalidateQueries({ queryKey: qk.settings });
  };

  /** Optimistic update of the cached settings, rolled back on failure. */
  const optimistic = async (update: (s: TaxSettingsDTO) => TaxSettingsDTO) => {
    await qc.cancelQueries({ queryKey: qk.taxes });
    const prev = qc.getQueryData<TaxSettingsDTO>(qk.taxes);
    if (prev) qc.setQueryData(qk.taxes, update(prev));
    return { prev };
  };

  const inclusive = useMutation({
    mutationFn: (pricesIncludeTax: boolean) => put<TaxSettingsDTO>('/api/admin/taxes', { pricesIncludeTax }),
    onMutate: (v) => optimistic((s) => ({ ...s, pricesIncludeTax: v })),
    onError: (err, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.taxes, ctx.prev);
      toast.error(errorMessage(err));
    },
    onSuccess: (dto) => {
      qc.setQueryData(qk.taxes, dto);
      toast.success(dto.pricesIncludeTax ? 'Prices now include tax' : 'Tax is now added at checkout');
    },
    onSettled: invalidate,
  });

  const toggleRate = useMutation({
    mutationFn: ({ rate, active }: { rate: TaxRateDTO; active: boolean }) => put<TaxRateDTO>(`/api/admin/taxes/rates/${rate.id}`, toBody(rate, { active })),
    onMutate: ({ rate, active }) => optimistic((s) => ({ ...s, rates: s.rates.map((r) => (r.id === rate.id ? { ...r, active } : r)) })),
    onError: (err, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.taxes, ctx.prev);
      toast.error(errorMessage(err));
    },
    onSettled: invalidate,
  });

  const remove = useMutation({
    mutationFn: (rate: TaxRateDTO) => del<void>(`/api/admin/taxes/rates/${rate.id}`),
    onSuccess: () => {
      invalidate();
      toast.success('Tax rate deleted');
      setDeleting(null);
    },
  });

  const addButton = (
    <Button variant="primary" icon={<IconPlus size={15} />} onClick={() => setEditing('new')}>
      Add tax rate
    </Button>
  );
  const rates = [...(q.data?.rates ?? [])].sort((a, b) => a.countryCode.localeCompare(b.countryCode) || (a.regionCode ?? '').localeCompare(b.regionCode ?? ''));

  return (
    <>
      <PageHeader title="Taxes" actions={q.data ? addButton : undefined} />
      {!q.data ? (
        <QueryState error={q.error} isPending={q.isPending} onRetry={() => void q.refetch()} />
      ) : (
        <div className="adm-stack">
          <Card title="Tax calculation">
            <Toggle
              label="Prices include tax"
              hint={
                q.data.pricesIncludeTax
                  ? 'Product prices already contain tax; checkout shows the tax portion.'
                  : 'Tax is calculated at checkout and added on top of product prices.'
              }
              checked={q.data.pricesIncludeTax}
              disabled={inclusive.isPending}
              onChange={(v) => inclusive.mutate(v)}
            />
          </Card>
          <Card title="Tax rates" flush>
            {rates.length === 0 ? (
              <EmptyState title="No tax rates" body="Add a rate for each country (or region) where you collect tax." action={addButton} />
            ) : (
              <DataTable
                caption="Tax rates"
                rows={rates}
                rowKey={(r) => r.id}
                columns={[
                  {
                    key: 'country',
                    header: 'Country',
                    sort: (a, b) => a.countryCode.localeCompare(b.countryCode),
                    cell: (r) => (
                      <span className="adm-cellstack">
                        <span className="adm-strong">{r.countryCode}</span>
                        <span className="adm-muted">{countryName(r.countryCode)}</span>
                      </span>
                    ),
                  },
                  { key: 'region', header: 'Region', cell: (r) => r.regionCode ?? <span className="adm-muted">All regions</span> },
                  { key: 'name', header: 'Name', cell: (r) => r.name, sort: (a, b) => a.name.localeCompare(b.name) },
                  { key: 'rate', header: 'Rate', align: 'right', cell: (r) => formatRate(r.rateBps), sort: (a, b) => a.rateBps - b.rateBps },
                  { key: 'shipping', header: 'On shipping', cell: (r) => (r.appliesToShipping ? 'Yes' : 'No') },
                  { key: 'active', header: 'Active', cell: (r) => <Toggle label={`${r.name} active`} labelHidden checked={r.active} onChange={(active) => toggleRate.mutate({ rate: r, active })} /> },
                  {
                    key: 'actions',
                    header: 'Actions',
                    hideHeader: true,
                    align: 'right',
                    cell: (r) => (
                      <span className="adm-row adm-row--tight adm-row--end">
                        <IconButton label={`Edit ${r.name}`} onClick={() => setEditing(r)}>
                          <IconEdit />
                        </IconButton>
                        <IconButton label={`Delete ${r.name}`} tone="danger" onClick={() => setDeleting(r)}>
                          <IconTrash />
                        </IconButton>
                      </span>
                    ),
                  },
                ]}
              />
            )}
          </Card>
        </div>
      )}

      {editing && <TaxRateModal rate={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={invalidate} />}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => {
          setDeleting(null);
          remove.reset();
        }}
        title={`Delete ${deleting?.name ?? 'tax rate'}?`}
        body="Future checkouts in this region will no longer charge this tax."
        confirmLabel="Delete"
        tone="danger"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </>
  );
}

function TaxRateModal({ rate, onClose, onSaved }: { rate: TaxRateDTO | null; onClose: () => void; onSaved: () => void }) {
  const formId = useId();
  const toast = useToast();
  const [countryCode, setCountryCode] = useState(rate?.countryCode ?? '');
  const [regionCode, setRegionCode] = useState(rate?.regionCode ?? '');
  const [name, setName] = useState(rate?.name ?? 'VAT');
  const [bps, setBps] = useState<number | null>(rate?.rateBps ?? null);
  const [shipping, setShipping] = useState(rate?.appliesToShipping ?? false);
  const [active, setActive] = useState(rate?.active ?? true);
  const [errors, setErrors] = useState<FieldErrors>({});

  const save = useMutation({
    mutationFn: (body: RateBody) => (rate ? put<TaxRateDTO>(`/api/admin/taxes/rates/${rate.id}`, body) : post<TaxRateDTO>('/api/admin/taxes/rates', body)),
    onSuccess: () => {
      onSaved();
      toast.success(rate ? 'Tax rate saved' : 'Tax rate added');
      onClose();
    },
    onError: (err) => setErrors(apiFieldErrors(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (save.isPending) return;
    const body: RateBody = { countryCode: countryCode.trim().toUpperCase(), regionCode: regionCode.trim() || null, name, rateBps: bps ?? -1, appliesToShipping: shipping, active };
    const errs = { ...(validate(TaxRateInput, body) ?? {}), ...(bps === null ? { rateBps: 'Enter a rate' } : {}) };
    if (Object.keys(errs).length) return setErrors(errs);
    setErrors({});
    save.mutate(body);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={rate ? `Edit ${rate.name}` : 'Add tax rate'}
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
        <div className="adm-grid adm-grid--2">
          <TextInput
            label="Country code"
            value={countryCode}
            maxLength={2}
            placeholder="LB"
            error={errors.countryCode}
            hint={countryCode.length === 2 ? countryName(countryCode) : '2 letters'}
            onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
            data-autofocus
          />
          <TextInput label="Region" optional value={regionCode} maxLength={80} error={errors.regionCode} hint="Leave empty for the whole country." onChange={(e) => setRegionCode(e.target.value)} />
          <TextInput label="Name" value={name} maxLength={60} error={errors.name} hint="Shown on receipts, e.g. VAT." onChange={(e) => setName(e.target.value)} />
          <PercentInput label="Rate" value={bps} error={errors.rateBps} hint="Decimals allowed, e.g. 11.5" onChange={setBps} />
        </div>
        <Checkbox label="Charge this tax on shipping" checked={shipping} onChange={setShipping} />
        <Checkbox label="Active" checked={active} onChange={setActive} />
      </form>
    </Modal>
  );
}
