import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { AdminDiscountInput, del, post, put, type DiscountDTO, type DiscountType } from '../../lib/contract';
import { fromDateTimeLocal, toDateTimeLocal } from '../../lib/dates';
import { apiFieldErrors, validate, type FieldErrors } from '../../lib/forms';
import { fmtDateTime } from '../../lib/format';
import { useUnsavedChanges } from '../../lib/hooks';
import { qk, useDiscount, useStore } from '../../lib/queries';
import { useCan } from '../../lib/session';
import { randomCode, sameJson } from '../../lib/util';
import { Button } from '../../ui/Button';
import { Badge, Banner, ErrorBanner, FormErrorSummary, QueryState } from '../../ui/feedback';
import { Checkbox, ChoiceGroup, MoneyInput, NumberInput, PercentInput, TextInput, Toggle } from '../../ui/form';
import { Card, DefinitionList, PageHeader, SaveBar } from '../../ui/layout';
import { ConfirmDialog } from '../../ui/Modal';
import { CollectionIdsField, ProductIdsField } from '../../ui/Pickers';
import { useToast } from '../../ui/Toasts';
import { DISCOUNT_STATE_META, discountState, discountSummary } from './discountUtils';

const BACK = { to: '/admin/discounts', label: 'Discounts' };
type Scope = 'any' | 'products' | 'collections';
type Targets = { productIds: string[]; collectionIds: string[] };

interface DiscountDraft {
  code: string;
  title: string;
  type: DiscountType;
  percentBps: number | null;
  amount: number | null;
  getPercentBps: number | null;
  appliesTo: 'all' | 'products' | 'collections';
  productIds: string[];
  collectionIds: string[];
  minReq: 'none' | 'subtotal' | 'quantity';
  minSubtotal: number | null;
  minQuantity: number | null;
  limitTotal: boolean;
  usageLimit: number | null;
  limitPerCustomer: boolean;
  usageLimitPerCustomer: number | null;
  buyQty: number | null;
  buyScope: Scope;
  buyTargets: Targets;
  getQty: number | null;
  getScope: Scope;
  getTargets: Targets;
  maxUsesPerOrder: number | null;
  startsAt: string;
  hasEnd: boolean;
  endsAt: string;
  status: 'active' | 'disabled';
}

const EMPTY_TARGETS: Targets = { productIds: [], collectionIds: [] };
const scopeOf = (t: Targets | undefined): Scope => (t?.productIds.length ? 'products' : t?.collectionIds.length ? 'collections' : 'any');

const fromDTO = (d: DiscountDTO): DiscountDraft => ({
  code: d.code,
  title: d.title,
  type: d.type,
  percentBps: d.type === 'percentage' ? d.value : null,
  amount: d.type === 'fixed_amount' ? d.value : null,
  getPercentBps: d.type === 'buy_x_get_y' ? d.value : 10_000,
  appliesTo: d.appliesTo,
  productIds: d.targets.productIds,
  collectionIds: d.targets.collectionIds,
  minReq: d.minSubtotal !== null ? 'subtotal' : d.minQuantity !== null ? 'quantity' : 'none',
  minSubtotal: d.minSubtotal,
  minQuantity: d.minQuantity,
  limitTotal: d.usageLimit !== null,
  usageLimit: d.usageLimit,
  limitPerCustomer: d.usageLimitPerCustomer !== null,
  usageLimitPerCustomer: d.usageLimitPerCustomer,
  buyQty: d.buyX?.quantity ?? 1,
  buyScope: scopeOf(d.buyX?.targets),
  buyTargets: d.buyX?.targets ?? EMPTY_TARGETS,
  getQty: d.getY?.quantity ?? 1,
  getScope: scopeOf(d.getY?.targets),
  getTargets: d.getY?.targets ?? EMPTY_TARGETS,
  maxUsesPerOrder: d.maxUsesPerOrder,
  startsAt: toDateTimeLocal(d.startsAt),
  hasEnd: d.endsAt !== null,
  endsAt: d.endsAt !== null ? toDateTimeLocal(d.endsAt) : '',
  status: d.status,
});

const emptyDraft = (): DiscountDraft => ({
  code: randomCode(),
  title: '',
  type: 'percentage',
  percentBps: null,
  amount: null,
  getPercentBps: 10_000,
  appliesTo: 'all',
  productIds: [],
  collectionIds: [],
  minReq: 'none',
  minSubtotal: null,
  minQuantity: null,
  limitTotal: false,
  usageLimit: null,
  limitPerCustomer: false,
  usageLimitPerCustomer: null,
  buyQty: 2,
  buyScope: 'any',
  buyTargets: EMPTY_TARGETS,
  getQty: 1,
  getScope: 'any',
  getTargets: EMPTY_TARGETS,
  maxUsesPerOrder: 1,
  startsAt: toDateTimeLocal(Date.now()),
  hasEnd: false,
  endsAt: '',
  status: 'active',
});

const TYPE_OPTIONS: { value: DiscountType; label: string; description: string }[] = [
  { value: 'percentage', label: 'Percentage', description: 'A percent off products.' },
  { value: 'fixed_amount', label: 'Fixed amount', description: 'A set amount off the order.' },
  { value: 'free_shipping', label: 'Free shipping', description: 'Waive shipping costs.' },
  { value: 'buy_x_get_y', label: 'Buy X get Y', description: 'Buy some items, get others discounted or free.' },
];

function targetsFor(scope: Scope, t: Targets): Targets {
  return scope === 'products' ? { productIds: t.productIds, collectionIds: [] } : scope === 'collections' ? { productIds: [], collectionIds: t.collectionIds } : EMPTY_TARGETS;
}

function buildPayload(d: DiscountDraft): { payload: AdminDiscountInput; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const bxgy = d.type === 'buy_x_get_y';
  let value = 0;
  if (d.type === 'percentage') {
    if (d.percentBps === null) errors.value = 'Enter a percentage';
    value = d.percentBps ?? 0;
  } else if (d.type === 'fixed_amount') {
    if (d.amount === null) errors.value = 'Enter an amount';
    value = d.amount ?? 0;
  } else if (bxgy) {
    if (d.getPercentBps === null) errors.value = 'Enter the discount on the items they get';
    value = d.getPercentBps ?? 0;
  }
  const scoped = d.type === 'percentage' || d.type === 'fixed_amount';
  const appliesTo = scoped ? d.appliesTo : 'all';
  if (appliesTo === 'products' && !d.productIds.length) errors['targets.productIds'] = 'Pick at least one product';
  if (appliesTo === 'collections' && !d.collectionIds.length) errors['targets.collectionIds'] = 'Pick at least one collection';
  if (d.minReq === 'subtotal' && d.minSubtotal === null) errors.minSubtotal = 'Enter a minimum amount';
  if (d.minReq === 'quantity' && d.minQuantity === null) errors.minQuantity = 'Enter a minimum quantity';
  if (d.limitTotal && d.usageLimit === null) errors.usageLimit = 'Enter a limit';
  if (d.limitPerCustomer && d.usageLimitPerCustomer === null) errors.usageLimitPerCustomer = 'Enter a limit';
  if (bxgy) {
    if (d.buyQty === null) errors['buyX.quantity'] = 'Enter a quantity';
    if (d.getQty === null) errors['getY.quantity'] = 'Enter a quantity';
    if (d.buyScope === 'products' && !d.buyTargets.productIds.length) errors['buyX.targets.productIds'] = 'Pick at least one product';
    if (d.buyScope === 'collections' && !d.buyTargets.collectionIds.length) errors['buyX.targets.collectionIds'] = 'Pick at least one collection';
    if (d.getScope === 'products' && !d.getTargets.productIds.length) errors['getY.targets.productIds'] = 'Pick at least one product';
    if (d.getScope === 'collections' && !d.getTargets.collectionIds.length) errors['getY.targets.collectionIds'] = 'Pick at least one collection';
  }
  const startsAt = fromDateTimeLocal(d.startsAt);
  if (startsAt === null) errors.startsAt = 'Pick a start date and time';
  const endsAt = d.hasEnd ? fromDateTimeLocal(d.endsAt) : null;
  if (d.hasEnd && endsAt === null) errors.endsAt = 'Pick an end date and time';

  const payload: AdminDiscountInput = {
    code: d.code,
    title: d.title,
    type: d.type,
    value,
    appliesTo,
    targets: scoped ? targetsFor(appliesTo === 'all' ? 'any' : appliesTo, { productIds: d.productIds, collectionIds: d.collectionIds }) : EMPTY_TARGETS,
    minSubtotal: d.minReq === 'subtotal' ? d.minSubtotal : null,
    minQuantity: d.minReq === 'quantity' ? d.minQuantity : null,
    usageLimit: d.limitTotal ? d.usageLimit : null,
    usageLimitPerCustomer: d.limitPerCustomer ? d.usageLimitPerCustomer : null,
    buyX: bxgy ? { quantity: d.buyQty ?? 0, targets: targetsFor(d.buyScope, d.buyTargets) } : null,
    getY: bxgy ? { quantity: d.getQty ?? 0, targets: targetsFor(d.getScope, d.getTargets) } : null,
    maxUsesPerOrder: bxgy ? d.maxUsesPerOrder : null,
    startsAt: startsAt ?? 0,
    endsAt,
    status: d.status,
  };
  return { payload, errors: { ...(validate(AdminDiscountInput, payload) ?? {}), ...errors } };
}

export default function DiscountEditor() {
  const { id } = useParams();
  const discount = useDiscount(id);
  const store = useStore();
  if ((id && !discount.data) || !store.data) {
    return (
      <>
        <PageHeader title={id ? 'Discount' : 'Create discount'} back={BACK} />
        <QueryState error={discount.error ?? store.error} isPending onRetry={() => void discount.refetch()} />
      </>
    );
  }
  return <DiscountForm key={id ?? 'new'} discount={discount.data ?? null} currency={store.data.currency} />;
}

function DiscountForm({ discount, currency }: { discount: DiscountDTO | null; currency: string }) {
  const isNew = !discount;
  const can = useCan();
  const canWrite = can('discounts:write');
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [base, setBase] = useState<DiscountDraft>(() => (discount ? fromDTO(discount) : emptyDraft()));
  const [draft, setDraft] = useState<DiscountDraft>(base);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty = !sameJson(base, draft);
  useUnsavedChanges(dirty && canWrite);
  const set = <K extends keyof DiscountDraft>(k: K, v: DiscountDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = useMutation({
    mutationFn: (payload: AdminDiscountInput) => (discount ? put<DiscountDTO>(`/api/admin/discounts/${discount.id}`, payload) : post<DiscountDTO>('/api/admin/discounts', payload)),
    onSuccess: (dto) => {
      qc.setQueryData(qk.discount(dto.id), dto);
      void qc.invalidateQueries({ queryKey: qk.discounts, exact: true });
      const next = fromDTO(dto);
      setBase(next);
      setDraft(next);
      setErrors({});
      toast.success(isNew ? 'Discount created' : 'Discount saved');
      if (isNew) navigate(`/admin/discounts/${dto.id}`, { replace: true });
    },
    onError: (err) => setErrors(apiFieldErrors(err)),
  });

  const remove = useMutation({
    mutationFn: () => del<void>(`/api/admin/discounts/${discount?.id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.discounts, exact: true });
      toast.success('Discount deleted');
      setBase(draft);
      navigate('/admin/discounts', { replace: true });
    },
  });

  const { payload } = buildPayload(draft);
  const submit = () => {
    if (save.isPending) return;
    const built = buildPayload(draft);
    setErrors(built.errors);
    if (Object.keys(built.errors).length) return window.scrollTo({ top: 0 });
    save.mutate(built.payload);
  };

  const summary = discountSummary(
    {
      type: draft.type,
      value: payload.value ?? 0,
      appliesTo: payload.appliesTo ?? 'all',
      targets: { productIds: payload.targets?.productIds ?? [], collectionIds: payload.targets?.collectionIds ?? [] },
      minSubtotal: payload.minSubtotal ?? null,
      minQuantity: payload.minQuantity ?? null,
      buyX: draft.type === 'buy_x_get_y' ? { quantity: draft.buyQty ?? 0, targets: EMPTY_TARGETS } : null,
      getY: draft.type === 'buy_x_get_y' ? { quantity: draft.getQty ?? 0, targets: EMPTY_TARGETS } : null,
    },
    currency,
  );
  const state = discountState({
    status: draft.status,
    startsAt: payload.startsAt,
    endsAt: payload.endsAt ?? null,
    usageLimit: payload.usageLimit ?? null,
    usageCount: discount?.usageCount ?? 0,
  });

  return (
    <>
      <PageHeader
        title={isNew ? 'Create discount' : base.code}
        back={BACK}
        meta={discount ? <Badge tone={DISCOUNT_STATE_META[discountState(discount)].tone}>{DISCOUNT_STATE_META[discountState(discount)].label}</Badge> : undefined}
        actions={
          discount && canWrite ? (
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          ) : undefined
        }
      />
      {!canWrite && <Banner tone="info">You can view this discount but not edit it.</Banner>}
      <FormErrorSummary errors={save.error ? {} : errors} />
      <ErrorBanner error={save.error} title="The discount was not saved" />

      <fieldset className="adm-fieldset" disabled={!canWrite}>
        <div className="adm-split">
          <div className="adm-split__main">
            <Card title="Code">
              <div className="adm-stack">
                <div className="adm-row adm-row--bottom">
                  <TextInput
                    label="Discount code"
                    className="adm-grow"
                    value={draft.code}
                    maxLength={64}
                    error={errors.code}
                    hint="Customers enter this at checkout. Letters, digits, - and _."
                    spellCheck={false}
                    onChange={(e) => set('code', e.target.value.toUpperCase().replace(/\s+/g, ''))}
                  />
                  <Button onClick={() => set('code', randomCode())}>Generate</Button>
                </div>
                <TextInput label="Internal title" optional value={draft.title} maxLength={120} error={errors.title} hint="Shown to staff only." onChange={(e) => set('title', e.target.value)} />
              </div>
            </Card>

            <Card title="Type">
              <ChoiceGroup label="Discount type" value={draft.type} options={TYPE_OPTIONS} columns={2} onChange={(type) => set('type', type)} />
            </Card>

            {(draft.type === 'percentage' || draft.type === 'fixed_amount') && (
              <Card title="Value">
                <div className="adm-stack">
                  {draft.type === 'percentage' ? (
                    <PercentInput label="Percentage off" value={draft.percentBps} error={errors.value} onChange={(v) => set('percentBps', v)} />
                  ) : (
                    <MoneyInput label="Amount off" currency={currency} value={draft.amount} error={errors.value} onChange={(v) => set('amount', v)} />
                  )}
                  <ChoiceGroup
                    label="Applies to"
                    value={draft.appliesTo}
                    onChange={(v) => set('appliesTo', v)}
                    options={[
                      { value: 'all', label: 'All products' },
                      { value: 'collections', label: 'Specific collections' },
                      { value: 'products', label: 'Specific products' },
                    ]}
                  />
                  {draft.appliesTo === 'products' && <ProductIdsField label="Products" ids={draft.productIds} error={errors['targets.productIds']} onChange={(ids) => set('productIds', ids)} />}
                  {draft.appliesTo === 'collections' && (
                    <CollectionIdsField label="Collections" ids={draft.collectionIds} error={errors['targets.collectionIds']} onChange={(ids) => set('collectionIds', ids)} />
                  )}
                </div>
              </Card>
            )}

            {draft.type === 'buy_x_get_y' && (
              <>
                <TargetCard
                  title="Customer buys"
                  prefix="buyX"
                  qty={draft.buyQty}
                  onQty={(v) => set('buyQty', v)}
                  scope={draft.buyScope}
                  onScope={(v) => set('buyScope', v)}
                  targets={draft.buyTargets}
                  onTargets={(t) => set('buyTargets', t)}
                  errors={errors}
                />
                <TargetCard
                  title="Customer gets"
                  prefix="getY"
                  qty={draft.getQty}
                  onQty={(v) => set('getQty', v)}
                  scope={draft.getScope}
                  onScope={(v) => set('getScope', v)}
                  targets={draft.getTargets}
                  onTargets={(t) => set('getTargets', t)}
                  errors={errors}
                >
                  <div className="adm-grid adm-grid--2">
                    <PercentInput label="Discount on these items" value={draft.getPercentBps} error={errors.value} hint="100% makes them free." onChange={(v) => set('getPercentBps', v)} />
                    <NumberInput
                      label="Max uses per order"
                      optional
                      min={1}
                      max={100}
                      value={draft.maxUsesPerOrder}
                      error={errors.maxUsesPerOrder}
                      hint="Leave empty for no limit."
                      onChange={(v) => set('maxUsesPerOrder', v)}
                    />
                  </div>
                </TargetCard>
              </>
            )}

            <Card title="Minimum requirements">
              <div className="adm-stack">
                <ChoiceGroup
                  label="Order must meet"
                  value={draft.minReq}
                  onChange={(v) => set('minReq', v)}
                  options={[
                    { value: 'none', label: 'No minimum' },
                    { value: 'subtotal', label: 'Minimum purchase amount' },
                    { value: 'quantity', label: 'Minimum quantity of items' },
                  ]}
                />
                {draft.minReq === 'subtotal' && <MoneyInput label="Minimum subtotal" currency={currency} value={draft.minSubtotal} error={errors.minSubtotal} onChange={(v) => set('minSubtotal', v)} />}
                {draft.minReq === 'quantity' && <NumberInput label="Minimum items" min={1} max={10_000} value={draft.minQuantity} error={errors.minQuantity} onChange={(v) => set('minQuantity', v)} />}
              </div>
            </Card>

            <Card title="Usage limits">
              <div className="adm-stack">
                <Checkbox label="Limit the total number of uses" checked={draft.limitTotal} onChange={(v) => set('limitTotal', v)} />
                {draft.limitTotal && <NumberInput label="Total uses" min={1} value={draft.usageLimit} error={errors.usageLimit} onChange={(v) => set('usageLimit', v)} />}
                <Checkbox label="Limit uses per customer" checked={draft.limitPerCustomer} onChange={(v) => set('limitPerCustomer', v)} />
                {draft.limitPerCustomer && (
                  <NumberInput label="Uses per customer" min={1} value={draft.usageLimitPerCustomer} error={errors.usageLimitPerCustomer} onChange={(v) => set('usageLimitPerCustomer', v)} />
                )}
              </div>
            </Card>

            <Card title="Active dates">
              <div className="adm-stack">
                <TextInput label="Starts" type="datetime-local" value={draft.startsAt} error={errors.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
                <Checkbox label="Set an end date" checked={draft.hasEnd} onChange={(v) => set('hasEnd', v)} />
                {draft.hasEnd && <TextInput label="Ends" type="datetime-local" value={draft.endsAt} min={draft.startsAt} error={errors.endsAt} onChange={(e) => set('endsAt', e.target.value)} />}
                <p className="adm-field__hint">Times are in your timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone}).</p>
              </div>
            </Card>
          </div>

          <div className="adm-split__side">
            <Card title="Status">
              <div className="adm-stack-sm">
                <Toggle label="Enabled" hint="Disabled codes can't be used at checkout." checked={draft.status === 'active'} onChange={(on) => set('status', on ? 'active' : 'disabled')} />
                <span>
                  <Badge tone={DISCOUNT_STATE_META[state].tone}>{DISCOUNT_STATE_META[state].label}</Badge>
                </span>
              </div>
            </Card>
            <Card title="Summary">
              <p className="adm-summary__code adm-mono">{draft.code || '—'}</p>
              <p className="adm-summary__text">{summary}</p>
              <DefinitionList
                items={[
                  ['Minimum', draft.minReq === 'none' ? 'None' : draft.minReq === 'subtotal' ? 'Purchase amount' : 'Item quantity'],
                  ['Uses', draft.limitTotal && draft.usageLimit ? `Up to ${draft.usageLimit.toLocaleString()}` : 'Unlimited'],
                  ['Per customer', draft.limitPerCustomer && draft.usageLimitPerCustomer ? `Up to ${draft.usageLimitPerCustomer}` : 'Unlimited'],
                  ['Starts', payload.startsAt ? fmtDateTime(payload.startsAt) : '—'],
                  ['Ends', payload.endsAt ? fmtDateTime(payload.endsAt) : 'No end date'],
                  ...(discount ? ([['Used', discount.usageCount.toLocaleString()]] as [string, string][]) : []),
                ]}
              />
            </Card>
          </div>
        </div>
      </fieldset>

      {canWrite && <SaveBar dirty={dirty} saving={save.isPending} onSave={submit} onDiscard={() => { setDraft(base); setErrors({}); }} saveLabel={isNew ? 'Create discount' : 'Save'} />}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${base.code}?`}
        body="Customers will no longer be able to use this code. Orders that used it are unaffected. This cannot be undone."
        confirmLabel="Delete discount"
        tone="danger"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}

function TargetCard({
  title,
  prefix,
  qty,
  onQty,
  scope,
  onScope,
  targets,
  onTargets,
  errors,
  children,
}: {
  title: string;
  prefix: 'buyX' | 'getY';
  qty: number | null;
  onQty: (v: number | null) => void;
  scope: Scope;
  onScope: (v: Scope) => void;
  targets: Targets;
  onTargets: (t: Targets) => void;
  errors: FieldErrors;
  children?: ReactNode;
}) {
  return (
    <Card title={title}>
      <div className="adm-stack">
        <NumberInput label="Quantity" min={1} max={100} value={qty} error={errors[`${prefix}.quantity`] ?? errors[prefix]} onChange={onQty} />
        <ChoiceGroup
          label="Any items from"
          value={scope}
          onChange={onScope}
          options={[
            { value: 'any', label: 'Any product' },
            { value: 'collections', label: 'Specific collections' },
            { value: 'products', label: 'Specific products' },
          ]}
        />
        {scope === 'products' && (
          <ProductIdsField label="Products" ids={targets.productIds} error={errors[`${prefix}.targets.productIds`]} onChange={(productIds) => onTargets({ ...targets, productIds })} />
        )}
        {scope === 'collections' && (
          <CollectionIdsField label="Collections" ids={targets.collectionIds} error={errors[`${prefix}.targets.collectionIds`]} onChange={(collectionIds) => onTargets({ ...targets, collectionIds })} />
        )}
        {children}
      </div>
    </Card>
  );
}
