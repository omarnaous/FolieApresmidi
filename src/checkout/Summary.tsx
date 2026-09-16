/**
 * What you are paying for: the lines with their thumbnails, then the sums.
 * Shared by the checkout aside, the order confirmation and the account.
 */
import { imageSrc, type MediaDTO, type PricingDTO } from '../../shared/api';
import { formatRate } from '../../shared/money';
import { variantLabel } from '../lib/catalog';

export interface SummaryLine {
  key: string;
  title: string;
  variantTitle: string;
  quantity: number;
  total: number;
  image: MediaDTO | null;
}

type Format = (amount: number) => string;

export function SummaryLines({ lines, format }: { lines: SummaryLine[]; format: Format }) {
  return (
    <ul className="co-lines">
      {lines.map((l) => (
        <li className="co-line" key={l.key}>
          <span className="plate packshot co-thumb">
            {l.image && <img src={imageSrc(l.image, 320)} alt={l.image.alt || l.title} loading="lazy" />}
          </span>
          <span className="co-line-mid">
            <span className="co-line-name">{l.title}</span>
            <span className="label muted">
              {[variantLabel(l.variantTitle), `×${l.quantity}`].filter(Boolean).join(' · ')}
            </span>
          </span>
          <span className="card-price co-line-price">{format(l.total)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Subtotal, each discount, shipping, tax, total. When prices already include
 * tax the tax is a note under the total rather than a line that adds to it.
 */
export function PricingRows({ pricing, format, refunded = 0 }: { pricing: PricingDTO; format: Format; refunded?: number }) {
  const shipping = pricing.shipping === null ? null : Math.max(0, pricing.shipping - pricing.shippingDiscount);
  return (
    <>
      <dl className="co-rows">
        <div className="co-row"><dt>Subtotal</dt><dd>{format(pricing.subtotal)}</dd></div>
        {pricing.discounts.map((d) => (
          <div className="co-row" key={d.code}><dt>{d.title || d.code}</dt><dd>−{format(d.amount)}</dd></div>
        ))}
        <div className="co-row">
          <dt>Shipping</dt>
          <dd>{shipping === null ? 'Calculated next' : shipping === 0 ? 'Free' : format(shipping)}</dd>
        </div>
        {!pricing.pricesIncludeTax && pricing.taxLines.map((t) => (
          <div className="co-row" key={t.name}><dt>{t.name} ({formatRate(t.rateBps)})</dt><dd>{format(t.amount)}</dd></div>
        ))}
        {refunded > 0 && <div className="co-row"><dt>Refunded</dt><dd>−{format(refunded)}</dd></div>}
      </dl>
      <div className="total co-total">
        <span className="label">Total</span>
        <b>{format(pricing.total)}</b>
      </div>
      {pricing.pricesIncludeTax && pricing.taxTotal > 0 && (
        <span className="label muted">
          Includes {pricing.taxLines.map((t) => `${format(t.amount)} ${t.name}`).join(', ')}
        </span>
      )}
    </>
  );
}
