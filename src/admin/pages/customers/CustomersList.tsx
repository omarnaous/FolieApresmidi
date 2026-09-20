import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { AdminCustomerListItemDTO } from '../../lib/contract';
import { fmtDate } from '../../lib/format';
import { useDebounced } from '../../lib/hooks';
import { qk, useFormatMoney, usePaged } from '../../lib/queries';
import { Button } from '../../ui/Button';
import { Badge, EmptyState, QueryState } from '../../ui/feedback';
import { Select, TextInput } from '../../ui/form';
import { Card, LoadMore, PageHeader } from '../../ui/layout';
import { DataTable } from '../../ui/Table';

const SORTS = [
  ['created_desc', 'Newest'],
  ['spent_desc', 'Top spenders'],
  ['orders_desc', 'Most orders'],
] as const;
type Sort = (typeof SORTS)[number][0];

export default function CustomersList() {
  const money = useFormatMoney();
  const [params, setParams] = useSearchParams();
  const rawSort = params.get('sort');
  const sort: Sort = SORTS.some(([v]) => v === rawSort) ? (rawSort as Sort) : 'created_desc';
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 300);

  const query = { q: q || undefined, sort, limit: 50 };
  const list = usePaged<AdminCustomerListItemDTO>(qk.customerList(query), '/api/admin/customers', query);
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;

  return (
    <>
      <PageHeader title="Customers" />
      <Card flush>
        <div className="adm-filters">
          <TextInput label="Search customers" labelHidden type="search" placeholder="Search by name, email or phone" value={search} onChange={(e) => setSearch(e.target.value)} className="adm-filters__grow" />
          <Select label="Sort by" value={sort} onChange={(e) => setParams(e.target.value === 'created_desc' ? {} : { sort: e.target.value }, { replace: true })}>
            {SORTS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        {list.data ? (
          rows.length === 0 ? (
            q ? (
              <EmptyState title="No customers match" body="Try a different name or email." action={<Button onClick={() => setSearch('')}>Clear search</Button>} />
            ) : (
              <EmptyState title="No customers yet" body="Customers appear here after their first order or when they create an account." />
            )
          ) : (
            <DataTable
              caption="Customers"
              rows={rows}
              rowKey={(c) => c.id}
              rowHref={(c) => `/admin/customers/${c.id}`}
              columns={[
                {
                  key: 'name',
                  header: 'Customer',
                  sort: (a, b) => a.name.localeCompare(b.name),
                  cell: (c) => (
                    <span className="adm-cellstack">
                      <Link to={`/admin/customers/${c.id}`} className="adm-link-strong">
                        {c.name || 'Unnamed'}
                      </Link>
                      <span className="adm-muted">{c.email}</span>
                    </span>
                  ),
                },
                { key: 'orders', header: 'Orders', align: 'right', cell: (c) => c.ordersCount.toLocaleString(), sort: (a, b) => a.ordersCount - b.ordersCount },
                { key: 'spent', header: 'Total spent', align: 'right', cell: (c) => money(c.totalSpent), sort: (a, b) => a.totalSpent - b.totalSpent },
                { key: 'marketing', header: 'Marketing', cell: (c) => <Badge tone={c.acceptsMarketing ? 'success' : 'neutral'}>{c.acceptsMarketing ? 'Subscribed' : 'Not subscribed'}</Badge> },
                { key: 'last', header: 'Last order', cell: (c) => (c.lastOrderAt ? fmtDate(c.lastOrderAt) : <span className="adm-muted">—</span>), sort: (a, b) => (a.lastOrderAt ?? 0) - (b.lastOrderAt ?? 0) },
              ]}
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
