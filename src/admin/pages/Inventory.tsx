import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { get, imageSrc, post, type InventoryRowDTO, type Page } from '../lib/contract';
import { useDebounced } from '../lib/hooks';
import { useCan } from '../lib/session';
import { Badge, EmptyState, ErrorBanner, QueryState } from '../ui/feedback';
import { NumberInput, TextInput } from '../ui/form';
import { Card, PageHeader, SaveBar } from '../ui/layout';
import { DataTable, Thumb } from '../ui/Table';
import { useToast } from '../ui/Toasts';

type Show = 'all' | 'low' | 'out';
const SHOW: { value: Show; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'low', label: 'Running low' },
  { value: 'out', label: 'Sold out' },
];

const key = (q: string, show: Show) => ['admin', 'inventory', q, show] as const;

/**
 * Stock for the whole shop on one screen. Type over any count and save the
 * lot at once; what is sent is the change you made, so a sale that happened
 * while the screen was open is not undone.
 */
export default function InventoryPage() {
  const can = useCan();
  const canWrite = can('products:write');
  const toast = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [show, setShow] = useState<Show>('all');
  const q = useDebounced(search.trim(), 250);
  const list = useQuery({
    queryKey: key(q, show),
    queryFn: ({ signal }) => get<Page<InventoryRowDTO>>('/api/admin/inventory', { q: q || undefined, show, limit: 200 }, signal),
  });

  /** variantId → the count typed in, against the count the screen loaded */
  const [edits, setEdits] = useState<Record<string, number | null>>({});
  useEffect(() => setEdits({}), [q, show]);

  const rows = list.data?.items ?? [];
  const baseline = useMemo(() => new Map(rows.map((r) => [r.variantId, r.onHand])), [rows]);
  const dirty = Object.entries(edits).filter(([id, v]) => v !== null && v !== baseline.get(id));
  const blank = Object.values(edits).some((v) => v === null);

  const save = useMutation({
    mutationFn: () =>
      post<{ items: InventoryRowDTO[] }>('/api/admin/inventory', {
        items: dirty.map(([variantId, onHand]) => ({ variantId, onHand: onHand as number, baseline: baseline.get(variantId) ?? 0 })),
      }),
    onSuccess: ({ items }) => {
      setEdits({});
      void qc.invalidateQueries({ queryKey: ['admin', 'inventory'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'products'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
      toast.success(`Stock saved on ${items.length} ${items.length === 1 ? 'piece' : 'pieces'}`);
    },
  });

  /** What is left to sell after the checkouts holding some right now. */
  const sellable = (r: InventoryRowDTO) => Math.max(0, r.onHand - r.reserved);

  return (
    <>
      <PageHeader title="Inventory" />
      <Card flush>
        {list.data ? (
          <>
            <div className="adm-filters">
              <TextInput
                label="Search stock"
                labelHidden
                type="search"
                placeholder="Search by product, size or SKU"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="adm-filters__grow"
              />
              <div className="adm-seggroup" role="group" aria-label="Show">
                {SHOW.map((s) => (
                  <button key={s.value} type="button" className="adm-seg" aria-pressed={show === s.value} onClick={() => setShow(s.value)}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <ErrorBanner error={save.error} title="The stock was not saved" />
            {rows.length === 0 ? (
              <EmptyState
                compact
                title={show === 'out' ? 'Nothing is sold out' : show === 'low' ? 'Nothing is running low' : 'No pieces match'}
                body={show === 'all' ? undefined : 'Everything has stock to sell.'}
              />
            ) : (
              <DataTable
                caption="Stock"
                rows={rows}
                rowKey={(r) => r.variantId}
                columns={[
                  {
                    key: 'piece',
                    header: 'Piece',
                    sort: (a, b) => a.productTitle.localeCompare(b.productTitle),
                    cell: (r) => (
                      <div className="adm-variantcell">
                        <Thumb src={r.image ? imageSrc(r.image, 320) : null} />
                        <span className="adm-cellstack">
                          <Link to={`/admin/products/${r.productId}`} className="adm-link-strong">
                            {r.productTitle}
                          </Link>
                          <span className="adm-muted adm-small">
                            {r.variantTitle}
                            {r.sku ? ` · ${r.sku}` : ''}
                          </span>
                        </span>
                      </div>
                    ),
                  },
                  {
                    key: 'state',
                    header: 'State',
                    cell: (r) =>
                      !r.tracked ? (
                        <Badge tone="neutral">Not counted</Badge>
                      ) : r.policy === 'continue' ? (
                        <Badge tone="info">Backorder</Badge>
                      ) : sellable(r) === 0 ? (
                        <Badge tone="danger">Sold out</Badge>
                      ) : (
                        <Badge tone="success">On sale</Badge>
                      ),
                  },
                  {
                    key: 'reserved',
                    header: 'In checkouts',
                    align: 'right',
                    cell: (r) => (r.reserved ? r.reserved.toLocaleString() : <span className="adm-muted">—</span>),
                    sort: (a, b) => a.reserved - b.reserved,
                  },
                  {
                    key: 'left',
                    header: 'Left to sell',
                    align: 'right',
                    cell: (r) => (r.tracked && r.policy === 'deny' ? sellable(r).toLocaleString() : <span className="adm-muted">∞</span>),
                    sort: (a, b) => a.onHand - a.reserved - (b.onHand - b.reserved),
                  },
                  {
                    key: 'onHand',
                    header: 'In stock',
                    align: 'right',
                    cell: (r) => (
                      <NumberInput
                        label={`Stock for ${r.productTitle} ${r.variantTitle}`}
                        labelHidden
                        className="adm-stockinput"
                        min={0}
                        max={1_000_000}
                        value={edits[r.variantId] !== undefined ? edits[r.variantId] : r.onHand}
                        disabled={!canWrite || save.isPending}
                        onChange={(v) => setEdits((e) => ({ ...e, [r.variantId]: v }))}
                      />
                    ),
                  },
                ]}
                footer={
                  <span className="adm-muted adm-small">
                    {rows.length.toLocaleString()} of {list.data.total.toLocaleString()} pieces
                    {list.data.nextCursor ? ' · narrow the search to see the rest' : ''}
                  </span>
                }
              />
            )}
          </>
        ) : (
          <div className="adm-card__pad">
            <QueryState error={list.error} isPending={list.isPending} onRetry={() => void list.refetch()} />
          </div>
        )}
      </Card>

      {canWrite && (
        <SaveBar
          dirty={dirty.length > 0}
          saving={save.isPending}
          saveLabel={`Save ${dirty.length} ${dirty.length === 1 ? 'change' : 'changes'}`}
          onSave={() => {
            if (!blank) save.mutate();
          }}
          onDiscard={() => setEdits({})}
        />
      )}
    </>
  );
}
