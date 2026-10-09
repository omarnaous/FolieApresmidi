import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  imageSrc,
  post,
  PRODUCT_STATUSES,
  type AdminListVariantDTO,
  type AdminProductListItemDTO,
  type Page,
  type ProductStatus,
  type QuickEditInput,
} from '../../lib/contract';
import { PRODUCT_STATUS_META } from '../../lib/format';
import { useDebounced, useUnsavedChanges } from '../../lib/hooks';
import { qk, useCurrency, useFormatMoney, usePaged } from '../../lib/queries';
import { useCan } from '../../lib/session';
import { plural } from '../../lib/util';
import { Button, ButtonLink } from '../../ui/Button';
import { EmptyState, ErrorBanner, ProductStatusBadge, QueryState } from '../../ui/feedback';
import { MoneyInput, NumberInput, TextInput } from '../../ui/form';
import { IconPlus } from '../../ui/icons';
import { Card, LoadMore, PageHeader, SaveBar } from '../../ui/layout';
import { ConfirmDialog } from '../../ui/Modal';
import { DataTable, Thumb } from '../../ui/Table';
import { Tabs, type TabItem } from '../../ui/Tabs';
import { useToast } from '../../ui/Toasts';
import { ImportModal } from './ImportModal';

type BulkAction = 'activate' | 'draft' | 'archive' | 'delete';
const BULK: Record<BulkAction, { label: string; verb: string }> = {
  activate: { label: 'Set active', verb: 'Set active' },
  draft: { label: 'Set draft', verb: 'Set to draft' },
  archive: { label: 'Archive', verb: 'Archive' },
  delete: { label: 'Delete', verb: 'Delete' },
};

const TABS: TabItem<ProductStatus | 'all'>[] = [
  { value: 'all', label: 'All' },
  ...(['active', 'draft', 'archived'] as const).map((s) => ({ value: s, label: PRODUCT_STATUS_META[s].label })),
];

export const inventorySummary = (p: Pick<AdminProductListItemDTO, 'inventoryTotal' | 'variantsCount'>) =>
  `${p.inventoryTotal.toLocaleString()} in stock${p.variantsCount > 1 ? ` across ${p.variantsCount} variants` : ''}`;

/** "Small / Red" → "Small": the size is what tells a row's stock boxes apart. */
const sizeOf = (v: AdminListVariantDTO) => v.title.split(' / ')[0] ?? v.title;
/** Typing in a cell edits it; it must not also open the product. */
const stay = (e: MouseEvent) => e.stopPropagation();

type QuickItem = QuickEditInput['items'][number];

export default function ProductsList() {
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const money = useFormatMoney();
  const [params, setParams] = useSearchParams();
  const raw = params.get('status');
  const status = PRODUCT_STATUSES.includes(raw as ProductStatus) ? (raw as ProductStatus) : undefined;
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebounced(search.trim(), 300);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<BulkAction | null>(null);
  const [importing, setImporting] = useState(false);
  const currency = useCurrency() ?? 'USD';
  /* Edits made in the table, saved together from the bar at the bottom:
     a product's price (applied to every size) and each size's stock. */
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  const [stock, setStock] = useState<Record<string, number | null>>({});

  useEffect(() => {
    setSelected(new Set());
    setPrices({});
    setStock({});
    const next = new URLSearchParams(params);
    if (q) next.set('q', q);
    else next.delete('q');
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [q, status]);

  const query = { status, q: q || undefined, limit: 50 };
  const list = usePaged<AdminProductListItemDTO>(qk.productList(query), '/api/admin/products', query);
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;
  const titles = new Map(rows.map((r) => [r.id, r.title]));

  const bulk = useMutation({
    mutationFn: (body: { ids: string[]; action: BulkAction }) => post<{ updated: number }>('/api/admin/products/bulk', body),
    onSuccess: (res, body) => {
      toast.success(`${BULK[body.action].verb}: ${plural(res.updated, 'product')}`);
      setSelected(new Set());
      setConfirm(null);
      void qc.invalidateQueries({ queryKey: qk.products });
      void qc.invalidateQueries({ queryKey: qk.collections });
      void qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    },
  });

  const canWrite = can('products:write');

  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const variantsById = useMemo(() => new Map(rows.flatMap((r) => r.variants.map((v) => [v.id, v] as const))), [rows]);

  /* Only what actually changed. Stock goes with the count the table showed,
     so a sale made meanwhile is kept; a number typed on an untracked piece
     starts tracking it. */
  const items = useMemo(() => {
    const out = new Map<string, QuickItem>();
    for (const [pid, cents] of Object.entries(prices)) {
      const p = byId.get(pid);
      if (!p || cents === null) continue;
      for (const v of p.variants) if (v.price !== cents) out.set(v.id, { variantId: v.id, price: cents });
    }
    for (const [vid, n] of Object.entries(stock)) {
      const v = variantsById.get(vid);
      if (!v || n === null) continue;
      if (n !== v.inventoryOnHand || !v.inventoryTracked) out.set(vid, { ...(out.get(vid) ?? { variantId: vid }), onHand: n, baseline: v.inventoryOnHand });
    }
    return [...out.values()];
  }, [prices, stock, byId, variantsById]);
  // a price emptied on a piece that had one, or a count emptied on a tracked size
  const blank =
    Object.entries(prices).some(([pid, v]) => v === null && byId.get(pid)?.priceMin === byId.get(pid)?.priceMax) ||
    Object.entries(stock).some(([vid, v]) => v === null && variantsById.get(vid)?.inventoryTracked);
  const editing = items.length > 0 || blank;
  useUnsavedChanges(editing);

  const quick = useMutation({
    mutationFn: () => post<{ items: AdminProductListItemDTO[] }>('/api/admin/products/quick-edit', { items }),
    onSuccess: (res) => {
      // swap the saved rows in place, so nothing jumps while you work down the list
      const fresh = new Map(res.items.map((i) => [i.id, i]));
      qc.setQueriesData<InfiniteData<Page<AdminProductListItemDTO>>>({ queryKey: [...qk.products, 'list'] }, (old) =>
        old ? { ...old, pages: old.pages.map((pg) => ({ ...pg, items: pg.items.map((it) => fresh.get(it.id) ?? it) })) } : old,
      );
      setPrices({});
      setStock({});
      toast.success(`Saved ${plural(res.items.length, 'product')}`);
      void qc.invalidateQueries({ queryKey: [...qk.products, 'detail'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'inventory'] });
      void qc.invalidateQueries({ queryKey: qk.collections });
      void qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    },
  });

  return (
    <>
      <PageHeader
        title="Products"
        actions={
          <>
            <ButtonLink to="/api/admin/products/export.csv" native download>
              Export CSV
            </ButtonLink>
            {canWrite && <Button onClick={() => setImporting(true)}>Import CSV</Button>}
            {canWrite && (
              <ButtonLink to="/admin/products/new" variant="primary" icon={<IconPlus size={15} />}>
                Add product
              </ButtonLink>
            )}
          </>
        }
      />
      <ErrorBanner error={quick.error} title="Prices and stock were not saved" />
      <Card flush>
        <Tabs label="Product status" items={TABS} value={status ?? 'all'} onChange={(v) => setParams(v === 'all' ? {} : { status: v }, { replace: true })} />
        <div className="adm-filters">
          <TextInput label="Search products" labelHidden type="search" placeholder="Search products" value={search} onChange={(e) => setSearch(e.target.value)} className="adm-filters__grow" />
        </div>

        {canWrite && selected.size > 0 && (
          <div className="adm-bulkbar" role="region" aria-label="Bulk actions">
            <span className="adm-strong">{selected.size} selected</span>
            {(Object.keys(BULK) as BulkAction[]).map((a) => (
              <Button key={a} size="sm" variant={a === 'delete' ? 'danger' : 'secondary'} onClick={() => setConfirm(a)}>
                {BULK[a].label}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear selection
            </Button>
          </div>
        )}

        {list.data ? (
          rows.length === 0 ? (
            q || status ? (
              <EmptyState title="No products match" body="Try another search or status." action={<Button onClick={() => { setSearch(''); setParams({}, { replace: true }); }}>Clear filters</Button>} />
            ) : (
              <EmptyState
                title="No products yet"
                body="Add your first piece, or import a catalogue from CSV."
                action={canWrite ? <ButtonLink to="/admin/products/new" variant="primary">Add product</ButtonLink> : undefined}
              />
            )
          ) : (
            <DataTable
              caption="Products"
              rows={rows}
              rowKey={(p) => p.id}
              rowHref={(p) => `/admin/products/${p.id}`}
              selection={canWrite ? { selected, onChange: setSelected, rowLabel: (id) => titles.get(id) ?? 'product' } : undefined}
              columns={[
                {
                  key: 'title',
                  header: 'Product',
                  sort: (a, b) => a.title.localeCompare(b.title),
                  cell: (p) => (
                    <div className="adm-variantcell">
                      <Thumb src={p.image ? imageSrc(p.image, 320) : null} alt="" />
                      <Link to={`/admin/products/${p.id}`} className="adm-link-strong">
                        {p.title}
                      </Link>
                    </div>
                  ),
                },
                { key: 'status', header: 'Status', cell: (p) => <ProductStatusBadge status={p.status} />, sort: (a, b) => a.status.localeCompare(b.status) },
                {
                  key: 'inventory',
                  header: 'Inventory',
                  sort: (a, b) => a.inventoryTotal - b.inventoryTotal,
                  cell: (p) =>
                    !canWrite || p.variants.length === 0 ? (
                      <span className={p.inventoryTotal <= 0 ? 'adm-danger-text' : undefined}>{inventorySummary(p)}</span>
                    ) : (
                      <div className="adm-qe adm-qe--stock" onClick={stay}>
                        {p.variants.map((v) => (
                          <span
                            key={v.id}
                            className="adm-qe__size"
                            title={v.inventoryTracked ? undefined : 'Not tracked — always available. Type a number to start counting it.'}
                          >
                            {p.variants.length > 1 && (
                              <span className="adm-qe__label" aria-hidden="true">
                                {sizeOf(v)}
                              </span>
                            )}
                            <NumberInput
                              label={`Stock for ${p.title}${p.variants.length > 1 ? `, ${v.title}` : ''}`}
                              labelHidden
                              className="adm-qe__stock"
                              min={0}
                              max={1_000_000}
                              placeholder={v.inventoryTracked ? undefined : '∞'}
                              value={stock[v.id] !== undefined ? stock[v.id]! : v.inventoryTracked ? v.inventoryOnHand : null}
                              disabled={quick.isPending}
                              onChange={(n) => setStock((s) => ({ ...s, [v.id]: n }))}
                            />
                          </span>
                        ))}
                      </div>
                    ),
                },
                { key: 'type', header: 'Type', cell: (p) => p.productType || <span className="adm-muted">—</span>, sort: (a, b) => a.productType.localeCompare(b.productType) },
                {
                  key: 'price',
                  header: 'Price',
                  align: 'right',
                  sort: (a, b) => a.priceMin - b.priceMin,
                  cell: (p) => {
                    const range = p.priceMin === p.priceMax ? money(p.priceMin) : `${money(p.priceMin)} – ${money(p.priceMax)}`;
                    if (!canWrite || p.variants.length === 0) return <span className="adm-nowrap">{range}</span>;
                    const same = p.priceMin === p.priceMax;
                    return (
                      <div className="adm-qe adm-qe--price" onClick={stay}>
                        <MoneyInput
                          label={`Price for ${p.title}`}
                          labelHidden
                          className="adm-qe__price"
                          currency={currency}
                          // sizes priced differently: empty until typed, then every size takes it
                          placeholder={same ? undefined : range}
                          value={prices[p.id] !== undefined ? prices[p.id]! : same ? p.priceMin : null}
                          disabled={quick.isPending}
                          onChange={(cents) => setPrices((x) => ({ ...x, [p.id]: cents }))}
                        />
                        {!same && <span className="adm-qe__hint">sets every size</span>}
                      </div>
                    );
                  },
                },
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

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => {
          setConfirm(null);
          bulk.reset();
        }}
        title={confirm ? `${BULK[confirm].verb} ${plural(selected.size, 'product')}?` : ''}
        body={
          confirm === 'delete'
            ? 'Deleted products are removed from the store and collections. Past orders keep their line items. This cannot be undone.'
            : confirm === 'archive'
              ? 'Archived products are hidden from the store but kept for your records.'
              : 'The change applies to every selected product.'
        }
        confirmLabel={confirm ? BULK[confirm].verb : 'Confirm'}
        tone={confirm === 'delete' ? 'danger' : 'primary'}
        pending={bulk.isPending}
        error={bulk.error}
        onConfirm={() => confirm && bulk.mutate({ ids: [...selected], action: confirm })}
      />
      <ImportModal open={importing} onClose={() => setImporting(false)} />
      {canWrite && (
        <SaveBar
          dirty={editing}
          saving={quick.isPending}
          saveLabel={blank ? 'Fill in the empty boxes' : `Save ${plural(items.length, 'change')}`}
          onSave={() => {
            if (!blank && items.length) quick.mutate();
          }}
          onDiscard={() => {
            setPrices({});
            setStock({});
            quick.reset();
          }}
        />
      )}
    </>
  );
}
