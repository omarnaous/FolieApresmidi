import { Link } from 'react-router';
import { formatMoney, type AdminOrderListItemDTO } from '../../lib/contract';
import { fmtDateTime, fmtNumber } from '../../lib/format';
import { OrderStatusBadge, PaymentBadge } from '../../ui/feedback';
import type { Column } from '../../ui/Table';

export function orderColumns({ customer = true }: { customer?: boolean } = {}): Column<AdminOrderListItemDTO>[] {
  const cols: Column<AdminOrderListItemDTO>[] = [
    {
      key: 'order',
      header: 'Order',
      cell: (o) => (
        <Link to={`/admin/orders/${o.id}`} className="adm-link-strong">
          {o.name}
        </Link>
      ),
      sort: (a, b) => a.number - b.number,
    },
    { key: 'date', header: 'Date', cell: (o) => <span className="adm-nowrap">{fmtDateTime(o.placedAt)}</span>, sort: (a, b) => a.placedAt - b.placedAt },
  ];
  if (customer) {
    cols.push({
      key: 'customer',
      header: 'Customer',
      cell: (o) => (
        <span className="adm-cellstack">
          <span>{o.customer?.name ?? 'Guest'}</span>
          <span className="adm-muted">{o.email}</span>
        </span>
      ),
      sort: (a, b) => (a.customer?.name ?? a.email).localeCompare(b.customer?.name ?? b.email),
    });
  }
  cols.push(
    { key: 'payment', header: 'Payment', cell: (o) => <PaymentBadge status={o.paymentStatus} /> },
    { key: 'status', header: 'Status', cell: (o) => <OrderStatusBadge status={o.status} /> },
    { key: 'items', header: 'Items', align: 'right', cell: (o) => fmtNumber(o.itemCount), sort: (a, b) => a.itemCount - b.itemCount },
    { key: 'total', header: 'Total', align: 'right', cell: (o) => <span className="adm-nowrap">{formatMoney(o.total, o.currency)}</span>, sort: (a, b) => a.total - b.total },
  );
  return cols;
}
