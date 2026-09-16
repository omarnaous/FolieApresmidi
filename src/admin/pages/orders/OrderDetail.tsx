import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { formatMoney, formatRate, imageSrc, OrderNoteInput, post, type AddressDTO, type AdminOrderDTO, type OrderEventDTO } from '../../lib/contract';
import { countryName, fmtDateTime, fmtRelative } from '../../lib/format';
import { qk, useOrder, useStore } from '../../lib/queries';
import { useCan } from '../../lib/session';
import { plural } from '../../lib/util';
import { Button } from '../../ui/Button';
import { Badge, EmptyState, ErrorBanner, OrderStatusBadge, PaymentBadge, QueryState } from '../../ui/feedback';
import { Textarea } from '../../ui/form';
import { IconEdit, IconExternal, IconPrint } from '../../ui/icons';
import { Card, PageHeader } from '../../ui/layout';
import { Thumb } from '../../ui/Table';
import { useToast } from '../../ui/Toasts';
import { AddressModal, OrderActionBar, useInvalidateOrderViews } from './OrderActions';

const BACK = { to: '/admin/orders', label: 'Orders' };

export default function OrderDetail() {
  const { id = '' } = useParams();
  const q = useOrder(id);
  if (!q.data) {
    return (
      <>
        <PageHeader title="Order" back={BACK} />
        <QueryState error={q.error} isPending={q.isPending} onRetry={() => void q.refetch()} />
      </>
    );
  }
  return <OrderView order={q.data} />;
}

function OrderView({ order: o }: { order: AdminOrderDTO }) {
  const can = useCan();
  const store = useStore();
  const [editAddress, setEditAddress] = useState(false);
  const money = (v: number) => formatMoney(v, o.currency);

  return (
    <>
      <div className="adm-noprint">
        <PageHeader
          title={o.name}
          back={BACK}
          meta={
            <>
              <span className="adm-muted">Placed {fmtDateTime(o.placedAt)}</span>
              <OrderStatusBadge status={o.status} />
              <PaymentBadge status={o.paymentStatus} />
            </>
          }
          actions={
            <Button icon={<IconPrint size={15} />} onClick={() => window.print()}>
              Print packing slip
            </Button>
          }
        />
        <OrderActionBar order={o} />

        <div className="adm-split">
          <div className="adm-split__main">
            <Card title={plural(o.itemCount, 'item')}>
              <ul className="adm-lines">
                {o.lines.map((l) => (
                  <li key={l.id} className="adm-line">
                    <Thumb src={l.image ? imageSrc(l.image, 320) : null} size={56} />
                    <div className="adm-line__main">
                      {l.productId && can('products:read') ? (
                        <Link to={`/admin/products/${l.productId}`} className="adm-link-strong">
                          {l.title}
                        </Link>
                      ) : (
                        <span className="adm-strong">{l.title}</span>
                      )}
                      {l.variantTitle && <span className="adm-muted">{l.variantTitle}</span>}
                      {l.sku && <span className="adm-muted adm-mono">SKU {l.sku}</span>}
                      {(l.refundedQuantity > 0 || l.fulfilledQuantity > 0) && (
                        <span className="adm-row adm-row--tight">
                          {l.fulfilledQuantity > 0 && <Badge tone="accent">{l.fulfilledQuantity} fulfilled</Badge>}
                          {l.refundedQuantity > 0 && <Badge tone="danger">{l.refundedQuantity} refunded</Badge>}
                        </span>
                      )}
                    </div>
                    <div className="adm-line__qty">
                      <span>
                        {l.quantity} × {money(l.unitPrice)}
                      </span>
                      {l.discount > 0 && <span className="adm-muted">−{money(l.discount)} discount</span>}
                    </div>
                    <div className="adm-line__total">{money(l.total)}</div>
                  </li>
                ))}
              </ul>
              <Totals order={o} />
            </Card>

            <Card title="Fulfillment">
              {o.fulfillments.length === 0 ? (
                <p className="adm-muted">Not fulfilled yet.</p>
              ) : (
                <ul className="adm-stack adm-list-plain">
                  {o.fulfillments.map((f) => (
                    <li key={f.id} className="adm-fulfillment">
                      <div className="adm-row adm-row--between">
                        <Badge tone={f.status === 'delivered' ? 'success' : f.status === 'cancelled' ? 'neutral' : 'accent'}>
                          {f.status.charAt(0).toUpperCase() + f.status.slice(1)}
                        </Badge>
                        <span className="adm-muted">{fmtDateTime(f.createdAt)}</span>
                      </div>
                      {(f.carrier || f.trackingNumber) && (
                        <p>
                          {f.carrier ?? 'Carrier'}
                          {f.trackingNumber && (
                            <>
                              {' · '}
                              {f.trackingUrl ? (
                                <a href={f.trackingUrl} target="_blank" rel="noopener noreferrer" className="adm-link">
                                  {f.trackingNumber} <IconExternal size={12} />
                                </a>
                              ) : (
                                <span className="adm-mono">{f.trackingNumber}</span>
                              )}
                            </>
                          )}
                        </p>
                      )}
                      <p className="adm-muted adm-small">
                        {f.shippedAt && `Shipped ${fmtDateTime(f.shippedAt)}`}
                        {f.shippedAt && f.deliveredAt && ' · '}
                        {f.deliveredAt && `Delivered ${fmtDateTime(f.deliveredAt)}`}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {o.refunds.length > 0 && (
              <Card title="Refunds">
                <ul className="adm-stack adm-list-plain">
                  {o.refunds.map((r) => (
                    <li key={r.id} className="adm-fulfillment">
                      <div className="adm-row adm-row--between">
                        <span className="adm-strong">{money(r.amount)}</span>
                        <span className="adm-muted">{fmtDateTime(r.createdAt)}</span>
                      </div>
                      <p className="adm-muted adm-small">
                        {r.staffName ? `By ${r.staffName}` : 'System'}
                        {r.restock ? ` · Restocked ${plural(r.lines.reduce((n, l) => n + l.quantity, 0), 'item')}` : ' · Not restocked'}
                      </p>
                      {r.reason && <p>{r.reason}</p>}
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <Timeline order={o} />
          </div>

          <div className="adm-split__side">
            <Card title="Customer">
              {o.customer ? (
                <div className="adm-stack-sm">
                  {can('customers:read') ? (
                    <Link to={`/admin/customers/${o.customer.id}`} className="adm-link-strong">
                      {o.customer.name}
                    </Link>
                  ) : (
                    <span className="adm-strong">{o.customer.name}</span>
                  )}
                  <span className="adm-muted">
                    {plural(o.customer.ordersCount, 'order')} · {money(o.customer.totalSpent)} spent
                  </span>
                </div>
              ) : (
                <p className="adm-muted">Guest checkout</p>
              )}
              <hr className="adm-hr" />
              <p className="adm-label adm-muted">Contact</p>
              <p>
                <a href={`mailto:${o.email}`} className="adm-link">
                  {o.email}
                </a>
              </p>
              {o.phone ? (
                <p>
                  <a href={`tel:${o.phone}`} className="adm-link">
                    {o.phone}
                  </a>
                </p>
              ) : (
                <p className="adm-muted">No phone number</p>
              )}
            </Card>

            <Card
              title="Shipping address"
              actions={
                can('orders:write') ? (
                  <Button size="sm" variant="ghost" icon={<IconEdit size={14} />} onClick={() => setEditAddress(true)}>
                    Edit
                  </Button>
                ) : undefined
              }
            >
              {o.shippingAddress ? <Address address={o.shippingAddress} /> : <p className="adm-muted">No shipping address</p>}
              <hr className="adm-hr" />
              <p className="adm-label adm-muted">Shipping method</p>
              <p>{o.shippingMethod ?? 'Not required'}</p>
            </Card>

            <Card title="Payment">
              <div className="adm-row adm-row--between">
                <span>{o.paymentMethod.name}</span>
                <PaymentBadge status={o.paymentStatus} />
              </div>
              {o.refundableAmount > 0 && o.pricing.refunded > 0 && <p className="adm-muted adm-small">{money(o.refundableAmount)} still refundable</p>}
            </Card>

            <Card title="Customer note">{o.note ? <p className="adm-prewrap">{o.note}</p> : <p className="adm-muted">No note from the customer.</p>}</Card>
          </div>
        </div>
      </div>

      <PackingSlip order={o} storeName={store.data?.name ?? 'FDM'} />
      {editAddress && <AddressModal order={o} onClose={() => setEditAddress(false)} />}
    </>
  );
}

const Row = ({ label, value, strong }: { label: ReactNode; value: string; strong?: boolean }) => (
  <div className={strong ? 'adm-totals__row adm-totals__row--strong' : 'adm-totals__row'}>
    <dt>{label}</dt>
    <dd>{value}</dd>
  </div>
);

function Totals({ order: o }: { order: AdminOrderDTO }) {
  const p = o.pricing;
  const money = (v: number) => formatMoney(v, o.currency);
  return (
    <dl className="adm-totals">
      <Row label="Subtotal" value={money(p.subtotal)} />
      {p.discounts.map((d) => (
        <Row
          key={d.code}
          label={
            <>
              Discount <span className="adm-code-chip">{d.code}</span>
            </>
          }
          value={`−${money(d.amount)}`}
        />
      ))}
      <Row label={`Shipping${o.shippingMethod ? ` · ${o.shippingMethod}` : ''}`} value={p.shipping === null ? '—' : money(p.shipping)} />
      {p.shippingDiscount > 0 && <Row label="Shipping discount" value={`−${money(p.shippingDiscount)}`} />}
      {p.taxLines.map((t) => (
        <Row key={t.name} label={`${t.name} (${formatRate(t.rateBps)})${p.pricesIncludeTax ? ' · included' : ''}`} value={money(t.amount)} />
      ))}
      <Row label="Total" value={money(p.total)} strong />
      {p.refunded > 0 && (
        <>
          <Row label="Refunded" value={`−${money(p.refunded)}`} />
          <Row label="Net" value={money(p.total - p.refunded)} strong />
        </>
      )}
    </dl>
  );
}

export function Address({ address: a }: { address: AddressDTO }) {
  return (
    <address className="adm-address">
      <span className="adm-strong">{a.name}</span>
      <span>{a.line1}</span>
      {a.line2 && <span>{a.line2}</span>}
      <span>{[a.city, a.region, a.postalCode].filter(Boolean).join(', ')}</span>
      <span>{countryName(a.countryCode)}</span>
      {a.phone && <span>{a.phone}</span>}
      {a.notes && <span className="adm-muted">“{a.notes}”</span>}
    </address>
  );
}

const actorName = (e: OrderEventDTO) =>
  e.actor.type === 'staff' ? e.actor.name ?? 'Staff' : e.actor.type === 'customer' ? e.actor.name ?? 'Customer' : e.actor.type === 'webhook' ? 'Payment provider' : 'System';

function Timeline({ order }: { order: AdminOrderDTO }) {
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const invalidate = useInvalidateOrderViews();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | undefined>();
  const note = useMutation({
    mutationFn: (b: string) => post<AdminOrderDTO>(`/api/admin/orders/${order.id}/notes`, { body: b }),
    onSuccess: (dto) => {
      qc.setQueryData(qk.order(order.id), dto);
      invalidate();
      setBody('');
      toast.success('Note added');
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (note.isPending) return;
    const r = OrderNoteInput.safeParse({ body });
    if (!r.success) return setError('Write a note first (up to 2,000 characters)');
    setError(undefined);
    note.mutate(body);
  };
  const events = [...order.events].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <Card title="Timeline">
      {can('orders:write') && (
        <form className="adm-composer" onSubmit={submit}>
          <ErrorBanner error={note.error} />
          <Textarea label="Add a note" labelHidden placeholder="Leave a note for the team…" rows={2} value={body} error={error} maxLength={2000} onChange={(e) => setBody(e.target.value)} />
          <div className="adm-row adm-row--end">
            <span className="adm-muted adm-small">Only staff can see notes.</span>
            <Button type="submit" size="sm" variant="primary" loading={note.isPending} disabled={!body.trim()}>
              Add note
            </Button>
          </div>
        </form>
      )}
      {events.length === 0 ? (
        <EmptyState compact title="No activity yet" />
      ) : (
        <ol className="adm-timeline">
          {events.map((e) => (
            <li key={e.id} className="adm-timeline__item">
              <p className="adm-timeline__msg">
                {e.message}
                {e.toStatus && (
                  <>
                    {' '}
                    <OrderStatusBadge status={e.toStatus} />
                  </>
                )}
              </p>
              <p className="adm-timeline__meta">
                {actorName(e)} ·{' '}
                <time dateTime={new Date(e.createdAt).toISOString()} title={fmtDateTime(e.createdAt)}>
                  {fmtRelative(e.createdAt)}
                </time>
              </p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function PackingSlip({ order: o, storeName }: { order: AdminOrderDTO; storeName: string }) {
  return (
    <section className="adm-slip" aria-hidden="true">
      <header className="adm-slip__head">
        <div>
          <p className="adm-slip__store">{storeName}</p>
          <p>Packing slip</p>
        </div>
        <div className="adm-slip__meta">
          <p className="adm-slip__order">{o.name}</p>
          <p>{fmtDateTime(o.placedAt)}</p>
        </div>
      </header>
      <div className="adm-slip__cols">
        <div>
          <p className="adm-label">Ship to</p>
          {o.shippingAddress ? <Address address={o.shippingAddress} /> : <p>—</p>}
        </div>
        <div>
          <p className="adm-label">Shipping method</p>
          <p>{o.shippingMethod ?? '—'}</p>
          <p className="adm-label">Contact</p>
          <p>{o.email}</p>
          {o.phone && <p>{o.phone}</p>}
        </div>
      </div>
      <table className="adm-slip__table">
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">SKU</th>
            <th scope="col">Qty</th>
          </tr>
        </thead>
        <tbody>
          {o.lines
            .filter((l) => l.quantity - l.refundedQuantity > 0)
            .map((l) => (
              <tr key={l.id}>
                <td>
                  {l.title}
                  {l.variantTitle && <div>{l.variantTitle}</div>}
                </td>
                <td>{l.sku ?? '—'}</td>
                <td>{l.quantity - l.refundedQuantity}</td>
              </tr>
            ))}
        </tbody>
      </table>
      {o.note && (
        <p>
          <strong>Note:</strong> {o.note}
        </p>
      )}
      <p className="adm-slip__thanks">Thank you for shopping with {storeName}.</p>
    </section>
  );
}
