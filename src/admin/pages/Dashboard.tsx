import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { formatMoney, imageSrc, ORDER_STATUSES, type DashboardDTO } from '../lib/contract';
import { parseSeriesDate, rangeFromParams, resolveRange, writeRangeParams, type RangePreset } from '../lib/dates';
import { fmtDate, fmtNumber, fmtPct, fmtShortDate, ORDER_STATUS_META, pctChange } from '../lib/format';
import { useDashboard } from '../lib/queries';
import { useCan } from '../lib/session';
import { cx, plural } from '../lib/util';
import { DateRangePicker } from '../ui/DateRangePicker';
import { Badge, EmptyState, QueryState, Skeleton } from '../ui/feedback';
import { Card, PageHeader } from '../ui/layout';
import { SimpleChart } from '../ui/SimpleChart';
import { DataTable, Thumb } from '../ui/Table';
import { orderColumns } from './orders/orderColumns';

const PRESETS: RangePreset[] = ['today', '7d', '30d', '90d', 'ytd', 'custom'];

export default function Dashboard() {
  const [params, setParams] = useSearchParams();
  const range = rangeFromParams(params, '30d');
  const resolved = resolveRange(range) ?? (resolveRange({ preset: '30d' }) as { from: number; to: number });
  const q = useDashboard(resolved.from, resolved.to);

  return (
    <>
      <PageHeader
        title="Dashboard"
        meta={
          <span className="adm-muted">
            {fmtDate(resolved.from)} – {fmtDate(resolved.to)}
          </span>
        }
        actions={<DateRangePicker value={range} presets={PRESETS} onChange={(v) => setParams((p) => writeRangeParams(p, v, '30d'), { replace: true })} />}
      />
      {q.data ? (
        <DashboardBody data={q.data} refreshing={q.isPlaceholderData} />
      ) : q.error ? (
        <QueryState error={q.error} isPending={false} onRetry={() => void q.refetch()} />
      ) : (
        <DashboardSkeleton />
      )}
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="adm-stack" role="status" aria-label="Loading dashboard">
      <div className="adm-kpis">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="adm-kpi">
            <Skeleton width="50%" height={10} />
            <Skeleton width="70%" height={30} />
            <Skeleton width="60%" height={10} />
          </div>
        ))}
      </div>
      <Skeleton height={260} width="100%" />
    </div>
  );
}

function Kpi({ label, value, current, previous }: { label: string; value: string; current?: number; previous?: number }) {
  const change = current !== undefined && previous !== undefined ? pctChange(current, previous) : undefined;
  return (
    <div className="adm-kpi">
      <p className="adm-label adm-muted">{label}</p>
      <p className="adm-kpi__value">{value}</p>
      <p className="adm-kpi__delta">
        {change === undefined ? (
          <span className="adm-muted">No comparison available</span>
        ) : change === null ? (
          <span className="adm-muted">None in the previous period</span>
        ) : (
          <>
            <span className={cx('adm-delta', change > 0 && 'adm-delta--up', change < 0 && 'adm-delta--down')}>
              <span aria-hidden="true">{change > 0 ? '▲' : change < 0 ? '▼' : '■'}</span> {fmtPct(change)}
            </span>{' '}
            <span className="adm-muted">vs previous period</span>
          </>
        )}
      </p>
    </div>
  );
}

function DashboardBody({ data, refreshing }: { data: DashboardDTO; refreshing: boolean }) {
  const can = useCan();
  const [metric, setMetric] = useState<'revenue' | 'orders'>('revenue');
  const money = (v: number) => formatMoney(v, data.currency);
  const points = data.series.map((s) => ({ label: fmtShortDate(parseSeriesDate(s.date)), value: metric === 'revenue' ? s.revenue : s.orders }));
  const fmtValue = metric === 'revenue' ? (v: number) => money(Math.round(v)) : (v: number) => fmtNumber(Math.round(v));
  const statusMax = Math.max(1, ...ORDER_STATUSES.map((s) => data.statusCounts[s] ?? 0));

  return (
    <div className={cx('adm-stack', refreshing && 'adm-refreshing')} aria-busy={refreshing}>
      <div className="adm-kpis">
        <Kpi label="Revenue" value={money(data.revenue)} current={data.revenue} previous={data.previous.revenue} />
        <Kpi label="Orders" value={fmtNumber(data.orders)} current={data.orders} previous={data.previous.orders} />
        <Kpi label="Average order value" value={money(data.averageOrderValue)} current={data.averageOrderValue} previous={data.previous.averageOrderValue} />
        <Kpi label="Items sold" value={fmtNumber(data.itemsSold)} current={data.itemsSold} previous={data.previous.itemsSold} />
        <Kpi label="New customers" value={fmtNumber(data.newCustomers)} current={data.newCustomers} previous={data.previous.newCustomers} />
      </div>

      <Card
        title={metric === 'revenue' ? 'Revenue over time' : 'Orders over time'}
        actions={
          <div className="adm-segmented" role="group" aria-label="Chart metric">
            <button type="button" className="adm-seg" aria-pressed={metric === 'revenue'} onClick={() => setMetric('revenue')}>
              Revenue
            </button>
            <button type="button" className="adm-seg" aria-pressed={metric === 'orders'} onClick={() => setMetric('orders')}>
              Orders
            </button>
          </div>
        }
      >
        {points.length === 0 ? (
          <EmptyState compact title="No sales in this period" body="Pick a longer range to see the trend." />
        ) : (
          <>
            <SimpleChart
              kind={metric === 'revenue' ? 'line' : 'bar'}
              integer={metric === 'orders'}
              points={points}
              formatValue={fmtValue}
              title={metric === 'revenue' ? 'Revenue per day' : 'Orders per day'}
              description={`${points.length} days from ${points[0]?.label} to ${points[points.length - 1]?.label}. Total ${
                metric === 'revenue' ? money(data.revenue) : plural(data.orders, 'order')
              }. Use the left and right arrow keys to read each day.`}
            />
            <details className="adm-details">
              <summary>View as table</summary>
              <div className="adm-table-wrap">
                <table className="adm-table">
                  <caption className="adm-sr">Daily revenue and orders</caption>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col" style={{ textAlign: 'right' }}>
                        Revenue
                      </th>
                      <th scope="col" style={{ textAlign: 'right' }}>
                        Orders
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.series.map((s) => (
                      <tr key={s.date}>
                        <td>{fmtDate(parseSeriesDate(s.date).getTime())}</td>
                        <td style={{ textAlign: 'right' }}>{money(s.revenue)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtNumber(s.orders)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </Card>

      <div className="adm-grid adm-grid--2">
        <Card title="Top products" flush>
          {data.topProducts.length === 0 ? (
            <EmptyState compact title="No products sold yet" />
          ) : (
            <DataTable
              caption="Top products"
              rows={data.topProducts}
              rowKey={(p) => p.productId ?? p.title}
              columns={[
                {
                  key: 'product',
                  header: 'Product',
                  cell: (p) => (
                    <div className="adm-variantcell">
                      <Thumb src={p.image ? imageSrc(p.image, 320) : null} size={36} />
                      {p.productId && can('products:read') ? (
                        <Link to={`/admin/products/${p.productId}`} className="adm-link-strong">
                          {p.title}
                        </Link>
                      ) : (
                        <span className="adm-strong">{p.title}</span>
                      )}
                    </div>
                  ),
                },
                { key: 'qty', header: 'Sold', align: 'right', cell: (p) => fmtNumber(p.quantity), sort: (a, b) => a.quantity - b.quantity },
                { key: 'revenue', header: 'Revenue', align: 'right', cell: (p) => money(p.revenue), sort: (a, b) => a.revenue - b.revenue },
              ]}
            />
          )}
        </Card>

        <Card title="Orders by status">
          <ul className="adm-bars">
            {ORDER_STATUSES.map((s) => {
              const n = data.statusCounts[s] ?? 0;
              const inner = (
                <>
                  <span className="adm-bars__label">{ORDER_STATUS_META[s].label}</span>
                  <span className="adm-bars__track" aria-hidden="true">
                    <span className="adm-bars__fill" style={{ width: `${(n / statusMax) * 100}%` }} />
                  </span>
                  <span className="adm-bars__num">{fmtNumber(n)}</span>
                </>
              );
              return (
                <li key={s}>
                  {can('orders:read') ? (
                    <Link to={`/admin/orders?status=${s}`} className="adm-bars__row">
                      {inner}
                    </Link>
                  ) : (
                    <div className="adm-bars__row">{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <div className="adm-grid adm-grid--2-1">
        <Card title="Recent orders" flush actions={can('orders:read') ? <Link to="/admin/orders" className="adm-link">View all</Link> : undefined}>
          {data.recentOrders.length === 0 ? (
            <EmptyState compact title="No orders yet" body="New orders will show up here as they come in." />
          ) : (
            <DataTable caption="Recent orders" rows={data.recentOrders} rowKey={(o) => o.id} columns={orderColumns()} rowHref={can('orders:read') ? (o) => `/admin/orders/${o.id}` : undefined} />
          )}
        </Card>

        <Card title="Low stock">
          {data.lowStock.length === 0 ? (
            <EmptyState compact title="Stock looks healthy" body="Nothing is below the low-stock threshold." />
          ) : (
            <ul className="adm-lowstock">
              {data.lowStock.map((item) => (
                <li key={item.variantId}>
                  <Link to={`/admin/products/${item.productId}`} className="adm-lowstock__row">
                    <span className="adm-cellstack">
                      <span className="adm-strong">{item.productTitle}</span>
                      <span className="adm-muted">{item.variantTitle}</span>
                    </span>
                    <Badge tone={item.onHand <= 0 ? 'danger' : 'warning'}>{item.onHand <= 0 ? 'Out of stock' : `${item.onHand} left`}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
