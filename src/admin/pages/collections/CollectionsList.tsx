import { useState } from 'react';
import { Link } from 'react-router';
import { imageSrc } from '../../lib/contract';
import { fmtDate } from '../../lib/format';
import { useCollections } from '../../lib/queries';
import { useCan } from '../../lib/session';
import { ButtonLink } from '../../ui/Button';
import { Badge, EmptyState, QueryState } from '../../ui/feedback';
import { TextInput } from '../../ui/form';
import { IconPlus } from '../../ui/icons';
import { Card, PageHeader } from '../../ui/layout';
import { DataTable, Thumb } from '../../ui/Table';

export default function CollectionsList() {
  const can = useCan();
  const q = useCollections();
  const [search, setSearch] = useState('');
  const rows = (q.data ?? []).filter((c) => c.title.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <>
      <PageHeader
        title="Collections"
        actions={
          can('products:write') ? (
            <ButtonLink to="/admin/collections/new" variant="primary" icon={<IconPlus size={15} />}>
              Create collection
            </ButtonLink>
          ) : undefined
        }
      />
      <Card flush>
        {q.data ? (
          q.data.length === 0 ? (
            <EmptyState
              title="No collections yet"
              body="Group products by hand, or let rules pick them automatically."
              action={can('products:write') ? <ButtonLink to="/admin/collections/new" variant="primary">Create collection</ButtonLink> : undefined}
            />
          ) : (
            <>
              <div className="adm-filters">
                <TextInput label="Search collections" labelHidden type="search" placeholder="Search collections" value={search} onChange={(e) => setSearch(e.target.value)} className="adm-filters__grow" />
              </div>
              {rows.length === 0 ? (
                <EmptyState compact title="No collections match" />
              ) : (
                <DataTable
                  caption="Collections"
                  rows={rows}
                  rowKey={(c) => c.id}
                  rowHref={(c) => `/admin/collections/${c.id}`}
                  columns={[
                    {
                      key: 'title',
                      header: 'Collection',
                      sort: (a, b) => a.title.localeCompare(b.title),
                      cell: (c) => (
                        <div className="adm-variantcell">
                          <Thumb src={c.image ? imageSrc(c.image, 320) : null} />
                          <span className="adm-cellstack">
                            <Link to={`/admin/collections/${c.id}`} className="adm-link-strong">
                              {c.title}
                            </Link>
                            <span className="adm-muted adm-small">/collections/{c.handle}</span>
                          </span>
                        </div>
                      ),
                    },
                    { key: 'type', header: 'Type', cell: (c) => (c.type === 'smart' ? 'Smart' : 'Manual'), sort: (a, b) => a.type.localeCompare(b.type) },
                    { key: 'count', header: 'Products', align: 'right', cell: (c) => c.productsCount.toLocaleString(), sort: (a, b) => a.productsCount - b.productsCount },
                    { key: 'published', header: 'Visibility', cell: (c) => <Badge tone={c.published ? 'success' : 'neutral'}>{c.published ? 'Published' : 'Hidden'}</Badge> },
                    { key: 'updated', header: 'Updated', cell: (c) => fmtDate(c.updatedAt), sort: (a, b) => a.updatedAt - b.updatedAt },
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
