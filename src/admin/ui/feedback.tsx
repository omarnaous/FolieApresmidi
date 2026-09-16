import type { ReactNode } from 'react';
import { ApiError, type OrderStatus, type PaymentStatus, type ProductStatus } from '../lib/contract';
import { pathLabel, type FieldErrors } from '../lib/forms';
import { ORDER_STATUS_META, PAYMENT_STATUS_META, PRODUCT_STATUS_META, type Tone } from '../lib/format';
import { cx } from '../lib/util';
import { Button } from './Button';

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx('adm-badge', `adm-badge--${tone}`, className)}>
      <span className="adm-badge__dot" aria-hidden="true" />
      {children}
    </span>
  );
}

export const OrderStatusBadge = ({ status }: { status: OrderStatus }) => (
  <Badge tone={ORDER_STATUS_META[status].tone}>{ORDER_STATUS_META[status].label}</Badge>
);
export const PaymentBadge = ({ status }: { status: PaymentStatus }) => (
  <Badge tone={PAYMENT_STATUS_META[status].tone}>{PAYMENT_STATUS_META[status].label}</Badge>
);
export const ProductStatusBadge = ({ status }: { status: ProductStatus }) => (
  <Badge tone={PRODUCT_STATUS_META[status].tone}>{PRODUCT_STATUS_META[status].label}</Badge>
);

export function Skeleton({ width, height = 14, className }: { width?: number | string; height?: number | string; className?: string }) {
  return <span className={cx('adm-skel', className)} style={{ width, height }} aria-hidden="true" />;
}

/** Placeholder page body while data loads. */
export function SkeletonBlock({ rows = 6, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div className="adm-skelblock" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="adm-skelblock__row">
          <Skeleton width={`${30 + ((i * 37) % 45)}%`} />
          <Skeleton width="14%" />
          <Skeleton width="10%" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action, compact }: { title: string; body?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={cx('adm-empty', compact && 'adm-empty--compact')}>
      <p className="adm-empty__title">{title}</p>
      {body && <p className="adm-empty__body">{body}</p>}
      {action && <div className="adm-empty__action">{action}</div>}
    </div>
  );
}

export const Forbidden = () => (
  <div className="adm-empty" role="alert">
    <p className="adm-empty__title">You don't have access to this.</p>
    <p className="adm-empty__body">Ask the store owner to grant you the permission if you need it.</p>
  </div>
);

export const isForbidden = (err: unknown) => err instanceof ApiError && err.status === 403;

export const errorMessage = (err: unknown): string => {
  if (err instanceof ApiError) {
    if (err.status === 403) return "You don't have access to this.";
    if (err.code === 'RATE_LIMITED') return 'Too many attempts. Wait a minute and try again.';
    if (err.code === 'NOT_FOUND') return err.message || 'This could not be found. It may have been deleted.';
    return err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong.';
};

/** Server or network failure: message, field list and request id. */
export function ErrorBanner({ error, title, onRetry, className }: { error: unknown; title?: string; onRetry?: () => void; className?: string }) {
  if (!error) return null;
  const apiErr = error instanceof ApiError ? error : null;
  const fields = apiErr ? Object.entries(apiErr.fields) : [];
  return (
    <div className={cx('adm-banner', 'adm-banner--danger', className)} role="alert">
      <div className="adm-banner__body">
        {title && <p className="adm-banner__title">{title}</p>}
        <p>{errorMessage(error)}</p>
        {fields.length > 0 && (
          <ul className="adm-banner__list">
            {fields.map(([k, v]) => (
              <li key={k}>
                <strong>{pathLabel(k)}:</strong> {v}
              </li>
            ))}
          </ul>
        )}
        {apiErr?.requestId && <p className="adm-banner__meta">Request ID {apiErr.requestId}</p>}
      </div>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Client-side validation summary. */
export function FormErrorSummary({ errors }: { errors: FieldErrors }) {
  const entries = Object.entries(errors);
  if (!entries.length) return null;
  return (
    <div className="adm-banner adm-banner--danger" role="alert">
      <div className="adm-banner__body">
        <p className="adm-banner__title">
          {entries.length === 1 ? '1 field needs attention' : `${entries.length} fields need attention`}
        </p>
        <ul className="adm-banner__list">
          {entries.map(([k, v]) => (
            <li key={k}>
              <strong>{pathLabel(k)}:</strong> {v}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function Banner({ tone = 'info', title, children, action }: { tone?: 'info' | 'warning' | 'success'; title?: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={cx('adm-banner', `adm-banner--${tone}`)} role="status">
      <div className="adm-banner__body">
        {title && <p className="adm-banner__title">{title}</p>}
        {children}
      </div>
      {action}
    </div>
  );
}

/** Query-state switch: error (incl. 403) → banner, loading → skeleton. */
export function QueryState({ error, isPending, onRetry, rows }: { error: unknown; isPending: boolean; onRetry?: () => void; rows?: number }) {
  if (error) return isForbidden(error) ? <Forbidden /> : <ErrorBanner error={error} onRetry={onRetry} />;
  if (isPending) return <SkeletonBlock rows={rows} />;
  return null;
}
