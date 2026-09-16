import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { get, type InventoryAdjustmentDTO } from '../../lib/contract';
import { fmtDateTime } from '../../lib/format';
import { qk } from '../../lib/queries';
import { cx } from '../../lib/util';
import { EmptyState, QueryState } from '../../ui/feedback';
import { Drawer } from '../../ui/Modal';

const REASONS: Record<string, string> = {
  manual: 'Manual adjustment',
  order: 'Order',
  refund_restock: 'Refund restock',
  cancel_restock: 'Cancellation restock',
  import: 'CSV import',
};

export function InventoryHistory({ variant, onClose }: { variant: { id: string; title: string } | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: qk.inventory(variant?.id ?? ''),
    queryFn: ({ signal }) => get<{ items: InventoryAdjustmentDTO[] }>(`/api/admin/variants/${variant?.id}/inventory`, undefined, signal),
    enabled: !!variant,
    staleTime: 0,
  });
  return (
    <Drawer open={!!variant} onClose={onClose} title={`Inventory history · ${variant?.title ?? ''}`}>
      {q.data ? (
        q.data.items.length === 0 ? (
          <EmptyState compact title="No stock movements yet" />
        ) : (
          <ol className="adm-timeline">
            {q.data.items.map((a) => (
              <li key={a.id} className="adm-timeline__item">
                <p className="adm-timeline__msg">
                  <span className={cx('adm-strong', a.delta < 0 ? 'adm-danger-text' : 'adm-success-text')}>
                    {a.delta > 0 ? '+' : ''}
                    {a.delta}
                  </span>{' '}
                  {REASONS[a.reason] ?? a.reason}
                  {a.orderId && (
                    <>
                      {' · '}
                      <Link to={`/admin/orders/${a.orderId}`} className="adm-link">
                        View order
                      </Link>
                    </>
                  )}
                </p>
                {a.note && <p>{a.note}</p>}
                <p className="adm-timeline__meta">
                  {a.staffName ?? 'System'} · {fmtDateTime(a.createdAt)}
                </p>
              </li>
            ))}
          </ol>
        )
      ) : (
        <QueryState error={q.error} isPending={q.isPending} onRetry={() => void q.refetch()} rows={4} />
      )}
    </Drawer>
  );
}
