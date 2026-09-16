import { Link } from 'react-router';
import type { AuditEntryDTO } from '../lib/contract';
import { fmtDateTime, fmtRelative } from '../lib/format';
import { qk, usePaged } from '../lib/queries';
import { EmptyState, QueryState } from '../ui/feedback';
import { Card, LoadMore, PageHeader } from '../ui/layout';
import { DataTable } from '../ui/Table';

const ENTITY_ROUTES: Record<string, string> = {
  order: '/admin/orders/',
  product: '/admin/products/',
  collection: '/admin/collections/',
  customer: '/admin/customers/',
  discount: '/admin/discounts/',
  page: '/admin/pages/',
};

function Entity({ entry }: { entry: AuditEntryDTO }) {
  const base = ENTITY_ROUTES[entry.entityType];
  const label = entry.entityType.replace(/_/g, ' ');
  if (base && entry.entityId) {
    return (
      <Link to={`${base}${entry.entityId}`} className="adm-link">
        {label}
      </Link>
    );
  }
  return <span>{label}</span>;
}

export default function AuditPage() {
  const list = usePaged<AuditEntryDTO>(qk.audit, '/api/admin/audit', {});
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;
  return (
    <>
      <PageHeader title="Audit log" meta={<span className="adm-muted">Every change made by staff, newest first.</span>} />
      <Card flush>
        {list.data ? (
          rows.length === 0 ? (
            <EmptyState title="Nothing logged yet" body="Staff actions such as edits, refunds and invitations are recorded here." />
          ) : (
            <DataTable
              caption="Audit log"
              rows={rows}
              rowKey={(e) => e.id}
              columns={[
                {
                  key: 'time',
                  header: 'Time',
                  cell: (e) => (
                    <time dateTime={new Date(e.createdAt).toISOString()} title={fmtDateTime(e.createdAt)} className="adm-nowrap">
                      {fmtRelative(e.createdAt)}
                    </time>
                  ),
                },
                { key: 'staff', header: 'Staff', cell: (e) => e.staff?.name ?? <span className="adm-muted">System</span> },
                { key: 'action', header: 'Action', cell: (e) => <span className="adm-mono">{e.action}</span> },
                { key: 'entity', header: 'Entity', cell: (e) => <Entity entry={e} /> },
                { key: 'summary', header: 'Summary', cell: (e) => e.summary },
                { key: 'ip', header: 'IP', cell: (e) => (e.ip ? <span className="adm-mono adm-small">{e.ip}</span> : <span className="adm-muted">—</span>) },
              ]}
              footer={<LoadMore shown={rows.length} total={total} hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} />}
            />
          )
        ) : (
          <div className="adm-card__pad">
            <QueryState error={list.error} isPending={list.isPending} onRetry={() => void list.refetch()} rows={10} />
          </div>
        )}
      </Card>
    </>
  );
}
