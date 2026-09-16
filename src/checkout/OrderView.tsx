/** One order, read back: the facts, where it is going, how far it has got, and the bill beside it. */
import type { ReactNode } from 'react';
import type { OrderDTO } from '../../shared/api';
import { formatMoney } from '../../shared/money';
import { STATUS_LABEL, formatDate, isWebUrl } from '../lib/format';
import { AddressLines } from '../ui/AddressLines';
import { PricingRows, SummaryLines } from './Summary';

export function OrderView({ order, head, children }: { order: OrderDTO; head: ReactNode; children?: ReactNode }) {
  const format = (amount: number) => formatMoney(amount, order.currency);
  const tracked = order.fulfillments.filter((f) => f.trackingNumber || isWebUrl(f.trackingUrl));

  return (
    <div className="co-body">
      <div className="co-form">
        <div className="co-head">{head}</div>

        <dl className="co-rows acct-facts">
          <div className="co-row"><dt>Placed</dt><dd>{formatDate(order.placedAt)}</dd></div>
          <div className="co-row"><dt>Status</dt><dd>{STATUS_LABEL[order.status]}</dd></div>
          <div className="co-row"><dt>Payment</dt><dd>{order.paymentMethod.name}</dd></div>
          {order.shippingMethod && <div className="co-row"><dt>Delivery</dt><dd>{order.shippingMethod}</dd></div>}
        </dl>

        {order.shippingAddress && (
          <section className="acct-block">
            <h2 className="label muted">Delivering to</h2>
            <AddressLines address={order.shippingAddress} />
          </section>
        )}

        {tracked.length > 0 && (
          <section className="acct-block">
            <h2 className="label muted">Tracking</h2>
            <ul className="acct-plain">
              {tracked.map((f) => (
                <li key={f.id}>
                  {[f.carrier, f.trackingNumber].filter(Boolean).join(' · ')}
                  {isWebUrl(f.trackingUrl) && (
                    <>
                      {' '}
                      <a className="link-u" href={f.trackingUrl} target="_blank" rel="noreferrer noopener">
                        Track the parcel ↗
                      </a>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {order.timeline.length > 0 && (
          <section className="acct-block">
            <h2 className="label muted">So far</h2>
            <ol className="acct-timeline">
              {order.timeline.map((t, i) => (
                <li key={`${t.at}-${i}`}>
                  <span className="label muted">{formatDate(t.at)}</span>
                  <span>{t.message}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {children}
      </div>

      <aside className="co-summary">
        <div className="co-summary-in">
          <div className="label muted">{order.itemCount} {order.itemCount === 1 ? 'piece' : 'pieces'}</div>
          <SummaryLines
            lines={order.lines.map((l) => ({
              key: l.id,
              title: l.title,
              variantTitle: l.variantTitle,
              quantity: l.quantity,
              total: l.total,
              image: l.image,
            }))}
            format={format}
          />
          <PricingRows pricing={order.pricing} format={format} refunded={order.pricing.refunded} />
        </div>
      </aside>
    </div>
  );
}
