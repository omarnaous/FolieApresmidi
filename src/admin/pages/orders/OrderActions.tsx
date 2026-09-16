import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import {
  AddressInput,
  formatMoney,
  OrderTransitionInput,
  patch,
  post,
  RefundInput,
  type AdminOrderDTO,
} from '../../lib/contract';
import { apiFieldErrors, scopeErrors, validate, type FieldErrors } from '../../lib/forms';
import { qk } from '../../lib/queries';
import { useCan } from '../../lib/session';
import { Button } from '../../ui/Button';
import { ErrorBanner } from '../../ui/feedback';
import { Checkbox, MoneyInput, NumberInput, Textarea, TextInput } from '../../ui/form';
import { Modal } from '../../ui/Modal';
import { useToast } from '../../ui/Toasts';

/** Lists, dashboard, customers and stock all move when an order does. */
export function useInvalidateOrderViews() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: [...qk.orders, 'list'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    void qc.invalidateQueries({ queryKey: qk.customers });
    void qc.invalidateQueries({ queryKey: qk.products });
  };
}

function useOrderMutation<V>(order: AdminOrderDTO, request: (v: V) => Promise<AdminOrderDTO>, success: string, onDone?: () => void) {
  const qc = useQueryClient();
  const toast = useToast();
  const invalidate = useInvalidateOrderViews();
  return useMutation({
    mutationFn: request,
    onSuccess: (dto) => {
      qc.setQueryData(qk.order(order.id), dto);
      invalidate();
      toast.success(success);
      onDone?.();
    },
  });
}

const useTransition = (order: AdminOrderDTO, success: string, onDone?: () => void) =>
  useOrderMutation<OrderTransitionInput>(order, (body) => post<AdminOrderDTO>(`/api/admin/orders/${order.id}/transition`, body), success, onDone);

type ModalKind = 'ship' | 'deliver' | 'cancel' | 'refund';

export function OrderActionBar({ order }: { order: AdminOrderDTO }) {
  const can = useCan();
  const [modal, setModal] = useState<ModalKind | null>(null);
  const allowed = new Set(order.allowedTransitions);
  const markPaid = useTransition(order, `${order.name} marked as paid`);
  const markFulfilled = useTransition(order, `${order.name} marked as fulfilled`);
  const writable = can('orders:write');
  const refundable = can('orders:refund') && order.refundableAmount > 0;
  const busy = markPaid.isPending || markFulfilled.isPending;

  if (!(writable && order.allowedTransitions.length) && !refundable) return null;

  return (
    <div className="adm-actionbar">
      <ErrorBanner error={markPaid.error ?? markFulfilled.error} />
      <div className="adm-row adm-row--wrap">
        {writable && allowed.has('paid') && (
          <Button variant="primary" loading={markPaid.isPending} disabled={busy} onClick={() => markPaid.mutate({ to: 'paid' })}>
            Mark as paid
          </Button>
        )}
        {writable && allowed.has('fulfilled') && (
          <Button variant="primary" loading={markFulfilled.isPending} disabled={busy} onClick={() => markFulfilled.mutate({ to: 'fulfilled' })}>
            Mark as fulfilled
          </Button>
        )}
        {writable && allowed.has('shipped') && (
          <Button variant="primary" disabled={busy} onClick={() => setModal('ship')}>
            Mark as shipped
          </Button>
        )}
        {writable && allowed.has('delivered') && (
          <Button variant="primary" disabled={busy} onClick={() => setModal('deliver')}>
            Mark as delivered
          </Button>
        )}
        {refundable && (
          <Button disabled={busy} onClick={() => setModal('refund')}>
            Refund
          </Button>
        )}
        {writable && allowed.has('cancelled') && (
          <Button variant="danger" disabled={busy} onClick={() => setModal('cancel')}>
            Cancel order
          </Button>
        )}
      </div>
      {modal === 'ship' && <ShipModal order={order} onClose={() => setModal(null)} />}
      {modal === 'deliver' && <DeliverModal order={order} onClose={() => setModal(null)} />}
      {modal === 'cancel' && <CancelModal order={order} onClose={() => setModal(null)} />}
      {modal === 'refund' && <RefundModal order={order} onClose={() => setModal(null)} />}
    </div>
  );
}

function ModalFooter({ formId, pending, label, tone = 'primary', onClose }: { formId: string; pending: boolean; label: string; tone?: 'primary' | 'danger'; onClose: () => void }) {
  return (
    <>
      <Button onClick={onClose} disabled={pending}>
        Back
      </Button>
      <Button type="submit" form={formId} variant={tone === 'danger' ? 'danger' : 'primary'} loading={pending}>
        {label}
      </Button>
    </>
  );
}

function ShipModal({ order, onClose }: { order: AdminOrderDTO; onClose: () => void }) {
  const formId = useId();
  const [carrier, setCarrier] = useState('');
  const [number, setNumber] = useState('');
  const [url, setUrl] = useState('');
  const [notify, setNotify] = useState(true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const m = useTransition(order, `${order.name} marked as shipped`, onClose);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (m.isPending) return;
    const body: OrderTransitionInput = {
      to: 'shipped',
      tracking: { carrier: carrier.trim() || null, number: number.trim() || null, url: url.trim() || null },
      notifyCustomer: notify,
    };
    const invalid = validate(OrderTransitionInput, body);
    if (invalid) return setErrors(invalid);
    setErrors({});
    m.mutate(body, { onError: (err) => setErrors(apiFieldErrors(err)) });
  };

  return (
    <Modal open onClose={onClose} title={`Ship ${order.name}`} dismissible={!m.isPending} footer={<ModalFooter formId={formId} pending={m.isPending} label="Mark as shipped" onClose={onClose} />}>
      <form id={formId} className="adm-stack" onSubmit={submit} noValidate>
        <ErrorBanner error={m.error} />
        <p className="adm-muted">Tracking details are optional. Customers see them on their order status page.</p>
        <TextInput label="Carrier" optional value={carrier} error={errors['tracking.carrier']} onChange={(e) => setCarrier(e.target.value)} placeholder="Aramex, DHL…" data-autofocus />
        <TextInput label="Tracking number" optional value={number} error={errors['tracking.number']} onChange={(e) => setNumber(e.target.value)} />
        <TextInput label="Tracking URL" optional type="url" value={url} error={errors['tracking.url']} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
        <Checkbox label="Email the customer a shipping confirmation" checked={notify} onChange={setNotify} />
      </form>
    </Modal>
  );
}

function DeliverModal({ order, onClose }: { order: AdminOrderDTO; onClose: () => void }) {
  const formId = useId();
  const unpaid = order.paymentStatus === 'unpaid';
  const [markPaid, setMarkPaid] = useState(unpaid);
  const [notify, setNotify] = useState(true);
  const m = useTransition(order, `${order.name} marked as delivered`, onClose);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!m.isPending) m.mutate({ to: 'delivered', markPaid: unpaid && markPaid, notifyCustomer: notify });
  };
  return (
    <Modal open onClose={onClose} title={`Mark ${order.name} as delivered`} size="sm" dismissible={!m.isPending} footer={<ModalFooter formId={formId} pending={m.isPending} label="Mark as delivered" onClose={onClose} />}>
      <form id={formId} className="adm-stack" onSubmit={submit}>
        <ErrorBanner error={m.error} />
        {unpaid && (
          <Checkbox
            label="Cash collected (mark as paid)"
            hint={`Records ${formatMoney(order.pricing.total, order.currency)} received on delivery.`}
            checked={markPaid}
            onChange={setMarkPaid}
          />
        )}
        <Checkbox label="Notify the customer" checked={notify} onChange={setNotify} />
      </form>
    </Modal>
  );
}

function CancelModal({ order, onClose }: { order: AdminOrderDTO; onClose: () => void }) {
  const formId = useId();
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(true);
  const [notify, setNotify] = useState(true);
  const m = useTransition(order, `${order.name} cancelled`, onClose);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!m.isPending) m.mutate({ to: 'cancelled', reason: reason.trim() || undefined, restock, notifyCustomer: notify });
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Cancel ${order.name}?`}
      dismissible={!m.isPending}
      footer={<ModalFooter formId={formId} pending={m.isPending} label="Cancel order" tone="danger" onClose={onClose} />}
    >
      <form id={formId} className="adm-stack" onSubmit={submit}>
        <ErrorBanner error={m.error} />
        <p>Cancelling can't be undone. Refund any payment separately if one was collected.</p>
        <Textarea label="Reason" optional rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus />
        <Checkbox label="Restock items" hint="Return the reserved quantities to inventory." checked={restock} onChange={setRestock} />
        <Checkbox label="Notify the customer" checked={notify} onChange={setNotify} />
      </form>
    </Modal>
  );
}

function RefundModal({ order, onClose }: { order: AdminOrderDTO; onClose: () => void }) {
  const formId = useId();
  const refundableLines = order.lines.filter((l) => l.quantity - l.refundedQuantity > 0);
  const [amount, setAmount] = useState<number | null>(order.refundableAmount);
  const [restock, setRestock] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number | null>>({});
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const money = (v: number) => formatMoney(v, order.currency);
  const m = useOrderMutation<RefundInput>(order, (body) => post<AdminOrderDTO>(`/api/admin/orders/${order.id}/refunds`, body), `Refund issued for ${order.name}`, onClose);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (m.isPending) return;
    const errs: FieldErrors = {};
    if (amount === null) errs.amount = 'Enter an amount';
    else if (amount <= 0) errs.amount = 'Must be more than zero';
    else if (amount > order.refundableAmount) errs.amount = `You can refund at most ${money(order.refundableAmount)}`;
    const lines = restock
      ? refundableLines.flatMap((l, i) => {
          const q = quantities[l.id] ?? 0;
          const max = l.quantity - l.refundedQuantity;
          if (q > max) errs[`lines.${i}.quantity`] = `At most ${max}`;
          return q > 0 ? [{ orderLineId: l.id, quantity: q }] : [];
        })
      : [];
    const body: RefundInput = { amount: amount ?? 0, reason: reason.trim() || undefined, restock, lines, notifyCustomer: notify };
    const all = { ...(validate(RefundInput, body) ?? {}), ...errs };
    if (Object.keys(all).length) return setErrors(all);
    setErrors({});
    m.mutate(body, { onError: (err) => setErrors(apiFieldErrors(err)) });
  };

  return (
    <Modal open onClose={onClose} title={`Refund ${order.name}`} dismissible={!m.isPending} footer={<ModalFooter formId={formId} pending={m.isPending} label="Issue refund" onClose={onClose} />}>
      <form id={formId} className="adm-stack" onSubmit={submit} noValidate>
        <ErrorBanner error={m.error} />
        <MoneyInput label="Refund amount" currency={order.currency} value={amount} onChange={setAmount} error={errors.amount} hint={`${money(order.refundableAmount)} available to refund`} />
        <Checkbox label="Restock items" hint="Choose how many of each item go back into inventory." checked={restock} onChange={setRestock} />
        {restock && (
          <div className="adm-table-wrap">
            <table className="adm-table adm-table--edit">
              <caption className="adm-sr">Quantities to restock</caption>
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col" style={{ width: '9rem' }}>
                    Restock
                  </th>
                </tr>
              </thead>
              <tbody>
                {refundableLines.map((l, i) => {
                  const max = l.quantity - l.refundedQuantity;
                  return (
                    <tr key={l.id}>
                      <td>
                        <span className="adm-cellstack">
                          <span className="adm-strong">{l.title}</span>
                          <span className="adm-muted">
                            {l.variantTitle ? `${l.variantTitle} · ` : ''}
                            {max} refundable
                          </span>
                        </span>
                      </td>
                      <td>
                        <NumberInput
                          label={`Quantity of ${l.title} to restock`}
                          labelHidden
                          min={0}
                          max={max}
                          value={quantities[l.id] ?? 0}
                          suffix={`/ ${max}`}
                          error={errors[`lines.${i}.quantity`]}
                          onChange={(n) => setQuantities((q) => ({ ...q, [l.id]: n }))}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Textarea label="Reason" optional rows={2} maxLength={500} value={reason} error={errors.reason} onChange={(e) => setReason(e.target.value)} />
        <Checkbox label="Email the customer a refund receipt" checked={notify} onChange={setNotify} />
      </form>
    </Modal>
  );
}

const ADDRESS_FIELDS = ['name', 'phone', 'line1', 'line2', 'city', 'region', 'postalCode', 'countryCode', 'notes'] as const;
type AddressDraft = Record<(typeof ADDRESS_FIELDS)[number], string>;

export function AddressModal({ order, onClose }: { order: AdminOrderDTO; onClose: () => void }) {
  const formId = useId();
  const a = order.shippingAddress;
  const [draft, setDraft] = useState<AddressDraft>({
    name: a?.name ?? '',
    phone: a?.phone ?? order.phone ?? '',
    line1: a?.line1 ?? '',
    line2: a?.line2 ?? '',
    city: a?.city ?? '',
    region: a?.region ?? '',
    postalCode: a?.postalCode ?? '',
    countryCode: a?.countryCode ?? '',
    notes: a?.notes ?? '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const m = useOrderMutation<{ shippingAddress: AddressInput }>(order, (body) => patch<AdminOrderDTO>(`/api/admin/orders/${order.id}`, body), 'Shipping address updated', onClose);
  const set = (k: keyof AddressDraft) => (v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (m.isPending) return;
    const address = { ...draft, region: draft.region || null, postalCode: draft.postalCode || null, notes: draft.notes || null };
    const parsed = AddressInput.safeParse(address);
    if (!parsed.success) return setErrors(validate(AddressInput, address) ?? {});
    setErrors({});
    m.mutate({ shippingAddress: parsed.data }, { onError: (err) => setErrors(scopeErrors(apiFieldErrors(err), 'shippingAddress')) });
  };

  return (
    <Modal open onClose={onClose} title="Edit shipping address" dismissible={!m.isPending} footer={<ModalFooter formId={formId} pending={m.isPending} label="Save address" onClose={onClose} />}>
      <form id={formId} className="adm-stack" onSubmit={submit} noValidate>
        <ErrorBanner error={m.error} />
        <div className="adm-grid adm-grid--2">
          <TextInput label="Full name" autoComplete="off" value={draft.name} error={errors.name} onChange={(e) => set('name')(e.target.value)} data-autofocus />
          <TextInput label="Phone" type="tel" value={draft.phone} error={errors.phone} onChange={(e) => set('phone')(e.target.value)} />
        </div>
        <TextInput label="Address" value={draft.line1} error={errors.line1} onChange={(e) => set('line1')(e.target.value)} />
        <TextInput label="Apartment, building, floor" optional value={draft.line2} error={errors.line2} onChange={(e) => set('line2')(e.target.value)} />
        <div className="adm-grid adm-grid--2">
          <TextInput label="City" value={draft.city} error={errors.city} onChange={(e) => set('city')(e.target.value)} />
          <TextInput label="Region" optional value={draft.region} error={errors.region} onChange={(e) => set('region')(e.target.value)} />
          <TextInput label="Postal code" optional value={draft.postalCode} error={errors.postalCode} onChange={(e) => set('postalCode')(e.target.value)} />
          <TextInput
            label="Country code"
            value={draft.countryCode}
            maxLength={2}
            hint="2 letters, e.g. LB"
            error={errors.countryCode}
            onChange={(e) => set('countryCode')(e.target.value.toUpperCase())}
          />
        </div>
        <Textarea label="Delivery notes" optional rows={2} maxLength={500} value={draft.notes} error={errors.notes} onChange={(e) => set('notes')(e.target.value)} />
      </form>
    </Modal>
  );
}
