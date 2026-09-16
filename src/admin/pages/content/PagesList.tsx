import { Link } from 'react-router';
import { fmtDate } from '../../lib/format';
import { usePages } from '../../lib/queries';
import { ButtonLink } from '../../ui/Button';
import { Badge, EmptyState, QueryState } from '../../ui/feedback';
import { IconPlus } from '../../ui/icons';
import { Card, PageHeader } from '../../ui/layout';
import { DataTable } from '../../ui/Table';

export default function PagesList() {
  const q = usePages();
  const add = (
    <ButtonLink to="/admin/pages/new" variant="primary" icon={<IconPlus size={15} />}>
      Add page
    </ButtonLink>
  );
  return (
    <>
      <PageHeader title="Pages" actions={add} />
      <Card flush>
        {q.data ? (
          q.data.length === 0 ? (
            <EmptyState title="No pages yet" body="Write your shipping, returns and privacy policies, or an about page." action={add} />
          ) : (
            <DataTable
              caption="Pages"
              rows={q.data}
              rowKey={(p) => p.id}
              rowHref={(p) => `/admin/pages/${p.id}`}
              columns={[
                {
                  key: 'title',
                  header: 'Title',
                  sort: (a, b) => a.title.localeCompare(b.title),
                  cell: (p) => (
                    <span className="adm-cellstack">
                      <Link to={`/admin/pages/${p.id}`} className="adm-link-strong">
                        {p.title}
                      </Link>
                      <span className="adm-muted adm-small">/{p.handle}</span>
                    </span>
                  ),
                },
                { key: 'kind', header: 'Kind', cell: (p) => (p.kind === 'policy' ? 'Policy' : 'Page'), sort: (a, b) => a.kind.localeCompare(b.kind) },
                { key: 'published', header: 'Visibility', cell: (p) => <Badge tone={p.published ? 'success' : 'neutral'}>{p.published ? 'Published' : 'Hidden'}</Badge> },
                { key: 'updated', header: 'Updated', cell: (p) => fmtDate(p.updatedAt), sort: (a, b) => a.updatedAt - b.updatedAt },
              ]}
            />
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
