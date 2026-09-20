import { useQueries, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { get, imageSrc, type AdminCollectionDTO, type AdminProductDTO, type AdminProductListItemDTO, type Page } from '../lib/contract';
import { useDebounced } from '../lib/hooks';
import { qk, useCollections } from '../lib/queries';
import { Button, Spinner } from './Button';
import { EmptyState, ErrorBanner, ProductStatusBadge } from './feedback';
import { TextInput } from './form';
import { IconClose } from './icons';
import { Modal } from './Modal';
import { Thumb } from './Table';

/** Search products and pick one or many. */
export function ProductPicker({
  open,
  onClose,
  onSelect,
  excludeIds = [],
  title = 'Add products',
  max,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (items: AdminProductListItemDTO[]) => void;
  excludeIds?: string[];
  title?: string;
  /** how many may be picked at once; the rest are disabled once it is reached */
  max?: number;
}) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Map<string, AdminProductListItemDTO>>(new Map());
  const search = useDebounced(q.trim(), 250);
  const list = useQuery({
    queryKey: [...qk.products, 'picker', search],
    queryFn: ({ signal }) => get<Page<AdminProductListItemDTO>>('/api/admin/products', { q: search || undefined, limit: 30 }, signal),
    enabled: open,
  });
  const exclude = new Set(excludeIds);
  const items = (list.data?.items ?? []).filter((p) => !exclude.has(p.id));
  const full = max !== undefined && picked.size >= max;

  const close = () => {
    setPicked(new Map());
    setQ('');
    onClose();
  };
  const toggle = (p: AdminProductListItemDTO) =>
    setPicked((m) => {
      const next = new Map(m);
      if (next.has(p.id)) next.delete(p.id);
      else next.set(p.id, p);
      return next;
    });

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      size="md"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            disabled={picked.size === 0}
            onClick={() => {
              onSelect([...picked.values()]);
              close();
            }}
          >
            {picked.size ? `Add ${picked.size}` : 'Add'}
          </Button>
        </>
      }
    >
      <TextInput label="Search products" labelHidden type="search" placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} data-autofocus />
      <div className="adm-gap-sm" />
      {list.error ? <ErrorBanner error={list.error} /> : null}
      {list.isPending ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState compact title="No products found" />
      ) : (
        <ul className="adm-picklist">
          {items.map((p) => (
            <li key={p.id}>
              <label className="adm-picklist__row">
                <input type="checkbox" checked={picked.has(p.id)} disabled={full && !picked.has(p.id)} onChange={() => toggle(p)} />
                <Thumb src={p.image ? imageSrc(p.image, 320) : null} size={36} />
                <span className="adm-picklist__title">{p.title}</span>
                <ProductStatusBadge status={p.status} />
              </label>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export function CollectionPicker({
  open,
  onClose,
  onSelect,
  excludeIds = [],
  manualOnly,
  title = 'Add collections',
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (items: AdminCollectionDTO[]) => void;
  excludeIds?: string[];
  manualOnly?: boolean;
  title?: string;
}) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const collections = useCollections();
  const exclude = new Set(excludeIds);
  const items = (collections.data ?? []).filter(
    (c) => !exclude.has(c.id) && (!manualOnly || c.type === 'manual') && c.title.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const close = () => {
    setPicked(new Set());
    setQ('');
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            disabled={picked.size === 0}
            onClick={() => {
              onSelect((collections.data ?? []).filter((c) => picked.has(c.id)));
              close();
            }}
          >
            {picked.size ? `Add ${picked.size}` : 'Add'}
          </Button>
        </>
      }
    >
      <TextInput label="Search collections" labelHidden type="search" placeholder="Search collections" value={q} onChange={(e) => setQ(e.target.value)} data-autofocus />
      <div className="adm-gap-sm" />
      {collections.error ? <ErrorBanner error={collections.error} /> : null}
      {collections.isPending ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState compact title="No collections found" />
      ) : (
        <ul className="adm-picklist">
          {items.map((c) => (
            <li key={c.id}>
              <label className="adm-picklist__row">
                <input
                  type="checkbox"
                  checked={picked.has(c.id)}
                  onChange={() =>
                    setPicked((s) => {
                      const next = new Set(s);
                      if (next.has(c.id)) next.delete(c.id);
                      else next.add(c.id);
                      return next;
                    })
                  }
                />
                <span className="adm-picklist__title">{c.title}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** Chips for a list of product ids, with a picker to add more. */
export function ProductIdsField({ label, ids, onChange, error }: { label: string; ids: string[]; onChange: (ids: string[]) => void; error?: string }) {
  const [open, setOpen] = useState(false);
  const details = useQueries({
    queries: ids.map((id) => ({
      queryKey: qk.product(id),
      queryFn: ({ signal }: { signal: AbortSignal }) => get<AdminProductDTO>(`/api/admin/products/${id}`, undefined, signal),
      staleTime: 5 * 60_000,
    })),
  });
  return (
    <div className="adm-field">
      <div className="adm-field__top">
        <span className="adm-field__label">{label}</span>
        <Button size="sm" variant="link" onClick={() => setOpen(true)}>
          Browse products
        </Button>
      </div>
      {ids.length === 0 ? (
        <p className="adm-muted">No products selected.</p>
      ) : (
        <ul className="adm-chiplist">
          {ids.map((id, i) => {
            const d = details[i]?.data;
            return (
              <li key={id} className="adm-chip">
                {d ? d.title : details[i]?.isError ? 'Unknown product' : 'Loading…'}
                <button type="button" className="adm-chip__x" aria-label={`Remove ${d?.title ?? 'product'}`} onClick={() => onChange(ids.filter((x) => x !== id))}>
                  <IconClose size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="adm-field__error">{error}</p>}
      <ProductPicker open={open} onClose={() => setOpen(false)} excludeIds={ids} onSelect={(items) => onChange([...ids, ...items.map((p) => p.id)])} />
    </div>
  );
}

export function CollectionIdsField({ label, ids, onChange, error }: { label: string; ids: string[]; onChange: (ids: string[]) => void; error?: string }) {
  const [open, setOpen] = useState(false);
  const collections = useCollections();
  const byId = new Map((collections.data ?? []).map((c) => [c.id, c]));
  return (
    <div className="adm-field">
      <div className="adm-field__top">
        <span className="adm-field__label">{label}</span>
        <Button size="sm" variant="link" onClick={() => setOpen(true)}>
          Browse collections
        </Button>
      </div>
      {ids.length === 0 ? (
        <p className="adm-muted">No collections selected.</p>
      ) : (
        <ul className="adm-chiplist">
          {ids.map((id) => {
            const c = byId.get(id);
            return (
              <li key={id} className="adm-chip">
                {c ? c.title : collections.isPending ? 'Loading…' : 'Unknown collection'}
                <button type="button" className="adm-chip__x" aria-label={`Remove ${c?.title ?? 'collection'}`} onClick={() => onChange(ids.filter((x) => x !== id))}>
                  <IconClose size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="adm-field__error">{error}</p>}
      <CollectionPicker open={open} onClose={() => setOpen(false)} excludeIds={ids} onSelect={(items) => onChange([...ids, ...items.map((c) => c.id)])} />
    </div>
  );
}
