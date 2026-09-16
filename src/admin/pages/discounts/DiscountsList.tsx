import { useState } from 'react';
import { Link } from 'react-router';
import { fmtDate } from '../../lib/format';
import { useCurrency, useDiscounts } from '../../lib/queries';
import { useCan } from '../../lib/session';
import { ButtonLink } from '../../ui/Button';
import { Badge, EmptyState, QueryState } from '../../ui/feedback';
import { TextInput } from '../../ui/form';
import { IconPlus } from '../../ui/icons';
import { Card, PageHeader } from '../../ui/layout';
import { DataTable } from '../../ui/Table';
import { Tabs, type TabItem } from '../../ui/Tabs';
import { DISCOUNT_STATE_META, discountState, discountSummary, type DiscountState } from './discountUtils';

export default function DiscountsList() {
  const can = useCan();
  const q = useDiscounts();
  const currency = useCurrency() ?? 'USD';
  const [tab, setTab] = useState<DiscountState | 'all'>('all');
  const [search, setSearch] = useState('');
  const now = Date.now();

  const all = (q.data ?? []).map((d) => ({ ...d, state: discountState(d, now) }));
  const rows = all.filter((d) => (tab === 'all' || d.state === tab) && `${d.code} ${d.title}`.toLowerCase().includes(search.trim().toLowerCase()));
  const tabs: TabItem<DiscountState | 'all'>[] = [
    { value: 'all', label: 'All', count: all.length },
    ...(Object.keys(DISCOUNT_STATE_META) as DiscountState[]).map((s) => ({ value: s, label: DISCOUNT_STATE_META[s].label, count: all.filter((d) => d.state === s).length })),
  ];
  const create = can('discounts:write') ? (
    <ButtonLink to="/admin/discounts/new" variant="primary" icon={<IconPlus size={15} />}>
      Create discount
    </ButtonLink>
  ) : undefined;

  return (
    <>
      <PageHeader title="Discounts" actions={create} />
      <Card flush>
        {q.data ? (
          q.data.length === 0 ? (
            <EmptyState title="No discounts yet" body="Create codes for percentage or fixed savings, free shipping, or buy-X-get-Y offers." action={create} />
          ) : (
            <>
              <Tabs label="Discount status" items={tabs} value={tab} onChange={setTab} />
              <div className="adm-filters">
                <TextInput label="Search discounts" labelHidden type="search" placeholder="Search by code or title" value={search} onChange={(e) => setSearch(e.target.value)} className="adm-filters__grow" />
              </div>
              {rows.length === 0 ? (
                <EmptyState compact title="No discounts match" />
              ) : (
                <DataTable
                  caption="Discounts"
                  rows={rows}
                  rowKey={(d) => d.id}
                  rowHref={(d) => `/admin/discounts/${d.id}`}
                  columns={[
                    {
                      key: 'code',
                      header: 'Code',
                      sort: (a, b) => a.code.localeCompare(b.code),
                      cell: (d) => (
                        <span className="adm-cellstack">
                          <Link to={`/admin/discounts/${d.id}`} className="adm-link-strong adm-mono">
                            {d.code}
                          </Link>
                          <span className="adm-muted">{discountSummary(d, currency)}</span>
                        </span>
                      ),
                    },
                    { key: 'status', header: 'Status', cell: (d) => <Badge tone={DISCOUNT_STATE_META[d.state].tone}>{DISCOUNT_STATE_META[d.state].label}</Badge> },
                    {
                      key: 'usage',
                      header: 'Used',
                      align: 'right',
                      sort: (a, b) => a.usageCount - b.usageCount,
                      cell: (d) => (d.usageLimit !== null ? `${d.usageCount.toLocaleString()} / ${d.usageLimit.toLocaleString()}` : d.usageCount.toLocaleString()),
                    },
                    {
                      key: 'window',
                      header: 'Active dates',
                      sort: (a, b) => a.startsAt - b.startsAt,
                      cell: (d) => <span className="adm-nowrap">{d.endsAt ? `${fmtDate(d.startsAt)} – ${fmtDate(d.endsAt)}` : `From ${fmtDate(d.startsAt)}`}</span>,
                    },
                  ]}
                />
              )}
            </>
          )
        ) : (
          <div className="adm-card__pad">
            <QueryState error={q.error} isPending={q.isPending} onRetry={() => void q.refetch()} />
          </div>
        )}
      </Card>
    </>
  );
}
