import { formatMoney } from '../../shared/money';
import { OrderView } from '../checkout/OrderView';
import { isNotFound, messageFor } from '../lib/errors';
import { STATUS_LABEL, formatDate } from '../lib/format';
import { useAccountOrder, useAccountOrders } from '../lib/queries';
import { SheetLink } from '../ui/SheetLink';
import { LoadError, Loading } from '../ui/States';

export function Orders() {
  const orders = useAccountOrders();
  const items = orders.data?.pages.flatMap((p) => p.items) ?? [];

  if (orders.isPending) return <Loading label="Finding your orders…" />;
  if (orders.isError && !orders.data) {
    return <LoadError title="Your orders did not load." message={messageFor(orders.error)} onRetry={() => orders.refetch()} />;
  }
  if (!items.length) {
    return (
      <div className="acct-state">
        <span className="display d-sm">No orders yet.</span>
        <span className="label muted">When you order, it will wait for you here.</span>
      </div>
    );
  }

  return (
    <>
      <ul className="acct-list">
        {items.map((o) => (
          <li key={o.id}>
            <SheetLink className="acct-row" to={`/account/orders/${o.number}`}>
              <span className="acct-row-main">
                <span className="co-line-name">Order {o.name}</span>
                <span className="label muted">
                  {formatDate(o.placedAt)} · {o.itemCount} {o.itemCount === 1 ? 'piece' : 'pieces'}
                </span>
              </span>
              <span className="label">{STATUS_LABEL[o.status]}</span>
              <span className="card-price">{formatMoney(o.total, o.currency)}</span>
            </SheetLink>
          </li>
        ))}
      </ul>
      {(orders.hasNextPage || orders.isFetchNextPageError) && (
        <div className="more">
          {orders.isFetchNextPageError && <span className="co-err label" role="alert">{messageFor(orders.error)}</span>}
          <button className="btn" onClick={() => orders.fetchNextPage()} disabled={orders.isFetchingNextPage}>
            {orders.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </>
  );
}

export function OrderDetail({ number }: { number: string }) {
  const order = useAccountOrder(number);
  const back = <SheetLink className="label link-u" to="/account/orders">← All orders</SheetLink>;

  if (order.isPending) return <Loading label="Opening the order…" />;
  if (order.isError) {
    return (
      <>
        {back}
        <LoadError
          title={isNotFound(order.error) ? 'There is no such order.' : 'This order did not load.'}
          message={isNotFound(order.error) ? undefined : messageFor(order.error)}
          onRetry={isNotFound(order.error) ? undefined : () => order.refetch()}
        />
      </>
    );
  }

  const o = order.data;
  return (
    <OrderView
      order={o}
      head={(
        <>
          {back}
          <h2 className="display d-sm">Order {o.name}</h2>
        </>
      )}
    />
  );
}
