import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { AdminCustomerUpdateInput, patch, type AdminCustomerDTO } from '../../lib/contract';
import { apiFieldErrors, validate, type FieldErrors } from '../../lib/forms';
import { fmtDate, fmtRelative } from '../../lib/format';
import { qk, useCustomer, useFormatMoney } from '../../lib/queries';
import { useCan } from '../../lib/session';
import { Button } from '../../ui/Button';
import { Badge, EmptyState, ErrorBanner, QueryState } from '../../ui/feedback';
import { Checkbox, Textarea, TextInput } from '../../ui/form';
import { IconEdit } from '../../ui/icons';
import { Card, PageHeader } from '../../ui/layout';
import { Modal } from '../../ui/Modal';
import { DataTable } from '../../ui/Table';
import { useToast } from '../../ui/Toasts';
import { Address } from '../orders/OrderDetail';
import { orderColumns } from '../orders/orderColumns';

const BACK = { to: '/admin/customers', label: 'Customers' };

export default function CustomerDetail() {
  const { id = '' } = useParams();
  const q = useCustomer(id);
  if (!q.data) {
    return (
      <>
        <PageHeader title="Customer" back={BACK} />
        <QueryState error={q.error} isPending={q.isPending} onRetry={() => void q.refetch()} />
      </>
    );
  }
  return <CustomerView customer={q.data} />;
}

function useCustomerUpdate(customer: AdminCustomerDTO, success: string, onDone?: () => void) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (body: CustomerUpdateBody) => patch<AdminCustomerDTO>(`/api/admin/customers/${customer.id}`, body),
    onSuccess: (dto) => {
      qc.setQueryData(qk.customer(customer.id), dto);
      void qc.invalidateQueries({ queryKey: [...qk.customers, 'list'] });
      toast.success(success);
      onDone?.();
    },
  });
}
type CustomerUpdateBody = { name?: string; phone?: string | null; note?: string | null; acceptsMarketing?: boolean };

function CustomerView({ customer: c }: { customer: AdminCustomerDTO }) {
  const can = useCan();
  const money = useFormatMoney();
  const [editing, setEditing] = useState(false);
  const canWrite = can('customers:write');

  return (
    <>
      <PageHeader
        title={c.name || c.email}
        back={BACK}
        meta={<span className="adm-muted">Customer since {fmtDate(c.createdAt)}</span>}
        actions={
          canWrite ? (
            <Button icon={<IconEdit size={14} />} onClick={() => setEditing(true)}>
              Edit customer
            </Button>
          ) : undefined
        }
      />

      <div className="adm-stats">
        <div className="adm-stat">
          <p className="adm-label adm-muted">Orders</p>
          <p className="adm-stat__value">{c.ordersCount.toLocaleString()}</p>
        </div>
        <div className="adm-stat">
          <p className="adm-label adm-muted">Lifetime value</p>
          <p className="adm-stat__value">{money(c.totalSpent)}</p>
        </div>
        <div className="adm-stat">
          <p className="adm-label adm-muted">Average order value</p>
          <p className="adm-stat__value">{money(c.averageOrderValue)}</p>
        </div>
        <div className="adm-stat">
          <p className="adm-label adm-muted">Last order</p>
          <p className="adm-stat__value">{c.lastOrderAt ? fmtRelative(c.lastOrderAt) : '—'}</p>
        </div>
      </div>

      <div className="adm-split">
        <div className="adm-split__main">
          <Card title="Orders" flush>
            {c.orders.length === 0 ? (
              <EmptyState compact title="No orders yet" />
            ) : (
              <DataTable caption="Customer orders" rows={c.orders} rowKey={(o) => o.id} columns={orderColumns({ customer: false })} rowHref={can('orders:read') ? (o) => `/admin/orders/${o.id}` : undefined} />
            )}
          </Card>
          <Card title="Addresses">
            {c.addresses.length === 0 ? (
              <p className="adm-muted">No saved addresses.</p>
            ) : (
              <ul className="adm-grid adm-grid--2 adm-list-plain">
                {c.addresses.map((a) => (
                  <li key={a.id} className="adm-addresscard">
                    {a.isDefault && <Badge tone="accent">Default</Badge>}
                    <Address address={a} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="adm-split__side">
          <Card title="Contact">
            <div className="adm-stack-sm">
              <a href={`mailto:${c.email}`} className="adm-link">
                {c.email}
              </a>
              {c.phone ? (
                <a href={`tel:${c.phone}`} className="adm-link">
                  {c.phone}
                </a>
              ) : (
                <span className="adm-muted">No phone number</span>
              )}
            </div>
          </Card>
          <Card title="Marketing">
            <div className="adm-stack-sm">
              <span>
                <Badge tone={c.acceptsMarketing ? 'success' : 'neutral'}>{c.acceptsMarketing ? 'Subscribed to emails' : 'Not subscribed'}</Badge>
              </span>
            </div>
          </Card>
          <NoteCard customer={c} canWrite={canWrite} />
        </div>
      </div>

      {editing && <EditCustomerModal customer={c} onClose={() => setEditing(false)} />}
    </>
  );
}

function NoteCard({ customer, canWrite }: { customer: AdminCustomerDTO; canWrite: boolean }) {
  const [note, setNote] = useState(customer.note ?? '');
  const save = useCustomerUpdate(customer, 'Note saved');
  const dirty = note !== (customer.note ?? '');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!save.isPending && dirty) save.mutate({ note: note.trim() || null });
  };
  return (
    <Card title="Internal note">
      {canWrite ? (
        <form className="adm-stack-sm" onSubmit={submit}>
          <ErrorBanner error={save.error} />
          <Textarea label="Note" labelHidden rows={4} maxLength={2000} value={note} placeholder="Sizing preferences, VIP details…" hint="Only staff can see this." onChange={(e) => setNote(e.target.value)} />
          <div className="adm-row adm-row--end">
            <Button type="submit" size="sm" variant="primary" disabled={!dirty} loading={save.isPending}>
              Save note
            </Button>
          </div>
        </form>
      ) : customer.note ? (
        <p className="adm-prewrap">{customer.note}</p>
      ) : (
        <p className="adm-muted">No note.</p>
      )}
    </Card>
  );
}

function EditCustomerModal({ customer, onClose }: { customer: AdminCustomerDTO; onClose: () => void }) {
  const formId = useId();
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone ?? '');
  const [marketing, setMarketing] = useState(customer.acceptsMarketing);
  const [errors, setErrors] = useState<FieldErrors>({});
  const save = useCustomerUpdate(customer, 'Customer updated', onClose);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (save.isPending) return;
    const body = { name, phone: phone.trim() || null, acceptsMarketing: marketing };
    const invalid = validate(AdminCustomerUpdateInput, body);
    if (invalid) return setErrors(invalid);
    setErrors({});
    save.mutate(body, { onError: (err) => setErrors(apiFieldErrors(err)) });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit customer"
      dismissible={!save.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id={formId} className="adm-stack" onSubmit={submit} noValidate>
        <ErrorBanner error={save.error} />
        <TextInput label="Name" value={name} error={errors.name} onChange={(e) => setName(e.target.value)} data-autofocus />
        <TextInput label="Phone" optional type="tel" value={phone} error={errors.phone} onChange={(e) => setPhone(e.target.value)} />
        <Checkbox label="Subscribed to marketing emails" hint="Only change this with the customer's consent." checked={marketing} onChange={setMarketing} />
      </form>
    </Modal>
  );
}
