import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ORDER_STATUSES, PAYMENT_STATUSES, type AdminOrderListItemDTO, type OrderStatus } from '../../lib/contract';
import { rangeFromParams, resolveRange, writeRangeParams, type RangePreset } from '../../lib/dates';
import { ORDER_STATUS_META, PAYMENT_STATUS_META } from '../../lib/format';
import { useDebounced } from '../../lib/hooks';
import { qk, usePaged } from '../../lib/queries';
import { Button, ButtonLink } from '../../ui/Button';
import { DateRangePicker } from '../../ui/DateRangePicker';
import { EmptyState, QueryState } from '../../ui/feedback';
import { Select, TextInput } from '../../ui/form';
import { IconExternal } from '../../ui/icons';
import { Card, LoadMore, PageHeader } from '../../ui/layout';
import { DataTable } from '../../ui/Table';
import { Tabs, type TabItem } from '../../ui/Tabs';
import { orderColumns } from './orderColumns';

const PRESETS: RangePreset[] = ['all', 'today', '7d', '30d', '90d', 'ytd', 'custom'];
const TABS: TabItem<OrderStatus | 'all'>[] = [{ value: 'all', label: 'All' }, ...ORDER_STATUSES.map((s) => ({ value: s, label: ORDER_STATUS_META[s].label }))];

const pick = <T extends string>(list: readonly T[], v: string | null): T | undefined => (list.includes(v as T) ? (v as T) : undefined);

export default function OrdersList() {
  const [params, setParams] = useSearchParams();
  const status = pick(ORDER_STATUSES, params.get('status'));
  const paymentStatus = pick(PAYMENT_STATUSES, params.get('payment'));
  const range = rangeFromParams(params, 'all');
  const resolved = resolveRange(range);
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebounced(search.trim(), 300);

  const setParam = (key: string, value: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  useEffect(() => {
    if ((params.get('q') ?? '') !== q) setParam('q', q || null);
  }, [q]);

  const query = { status, paymentStatus, q: q || undefined, from: resolved?.from, to: resolved?.to, limit: 50 };
  const list = usePaged<AdminOrderListItemDTO>(qk.orderList(query), '/api/admin/orders', query);
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;
  const filtered = !!(status || paymentStatus || q || resolved);

  return (
    <>
      <PageHeader title="Orders" />
      <Card flush>
        <Tabs label="Order status" items={TABS} value={status ?? 'all'} onChange={(v) => setParam('status', v === 'all' ? null : v)} />
        <div className="adm-filters">
          <TextInput label="Search orders" labelHidden type="search" placeholder="Search by order number, email or name" value={search} onChange={(e) => setSearch(e.target.value)} className="adm-filters__grow" />
          <Select label="Payment" value={paymentStatus ?? ''} onChange={(e) => setParam('payment', e.target.value || null)}>
            <option value="">Any payment status</option>
            {PAYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PAYMENT_STATUS_META[s].label}
              </option>
            ))}
          </Select>
          <DateRangePicker label="Placed" value={range} presets={PRESETS} onChange={(v) => setParams((p) => writeRangeParams(p, v, 'all'), { replace: true })} />
        </div>

        {list.data ? (
          rows.length === 0 ? (
            filtered ? (
              <EmptyState
                title="No orders match these filters"
                body="Try a different status, date range or search."
                action={
                  <Button
                    onClick={() => {
                      setSearch('');
                      setParams(new URLSearchParams(), { replace: true });
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title="No orders yet"
                body="When customers check out, their orders appear here."
                action={
                  <ButtonLink to="/" native target="_blank" rel="noopener" variant="primary" icon={<IconExternal size={14} />}>
                    View store
                  </ButtonLink>
                }
              />
            )
          ) : (
            <DataTable
              caption="Orders"
              rows={rows}
              rowKey={(o) => o.id}
              columns={orderColumns()}
              rowHref={(o) => `/admin/orders/${o.id}`}
              footer={<LoadMore shown={rows.length} total={total} hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} />}
            />
          )
        ) : (
          <div className="adm-card__pad">
            <QueryState error={list.error} isPending={list.isPending} onRetry={() => void list.refetch()} rows={8} />
          </div>
        )}
      </Card>
    </>
  );
}
