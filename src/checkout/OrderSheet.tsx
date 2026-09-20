/** /orders/:token — the confirmation after checkout, and the page a guest's order email links back to. */
import { formatMoney } from '../../shared/money';
import { isNotFound, messageFor } from '../lib/errors';
import { firstName } from '../lib/format';
import { useOrder } from '../lib/queries';
import { useLinger } from '../hooks/useSheet';
import { Sheet } from '../ui/Sheet';
import { OrderView } from './OrderView';

export default function OrderSheet({ token, onClose }: { token: string | null; onClose: () => void }) {
  const held = useLinger(token);
  const order = useOrder(held);
  const o = order.data;

  return (
    <Sheet open={!!token} label="Your order" onClose={onClose}>
      {held && (o ? (
        <OrderView
          order={o}
          head={(
            <>
              <div className="label muted">Order {o.name}</div>
              <h1 className="display d-md">
                Merci{firstName(o.shippingAddress?.name) ? `, ${firstName(o.shippingAddress?.name)}` : ''}.
              </h1>
              <p className="lede" aria-live="polite">
                {o.status === 'cancelled'
                  ? 'This order was cancelled. Write to us if that is a surprise.'
                  : `We have it. Paying by ${o.paymentMethod.name}, ${formatMoney(o.total, o.currency)}.`}
              </p>
            </>
          )}
        >
          <div className="co-actions">
            <button className="btn" onClick={onClose}>Back to the boutique</button>
          </div>
        </OrderView>
      ) : order.isError ? (
        <div className="co-done" role="alert">
          <h1 className="display d-md">{isNotFound(order.error) ? 'We cannot find that order.' : 'Your order did not load.'}</h1>
          <p className="lede">
            {isNotFound(order.error)
              ? 'The link may be incomplete. The email we sent has the full one.'
              : messageFor(order.error)}
          </p>
          {!isNotFound(order.error) && <button className="btn solid" onClick={() => order.refetch()}>Try again</button>}
          <button className="btn" onClick={onClose}>Back to the boutique</button>
        </div>
      ) : (
        <div className="co-done" aria-busy="true">
          <span className="label muted" role="status">Finding your order…</span>
        </div>
      ))}
    </Sheet>
  );
}
