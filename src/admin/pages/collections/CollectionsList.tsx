import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type DragEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { patch, put, type AdminCollectionDTO } from '../../lib/contract';
import { fmtDate } from '../../lib/format';
import { moveItem } from '../../lib/util';
import { qk, useCollections, useStore } from '../../lib/queries';
import { useCan } from '../../lib/session';
import { ButtonLink } from '../../ui/Button';
import { EmptyState, ErrorBanner, QueryState } from '../../ui/feedback';
import { TextInput, Toggle } from '../../ui/form';
import { IconMenu, IconPlus } from '../../ui/icons';
import { Card, PageHeader } from '../../ui/layout';
import { useToast } from '../../ui/Toasts';

/**
 * Every collection, in the order they stand on the shop. Drag a row by its
 * grip — or focus the grip and use the arrow keys — to move a category along
 * the row; the switch takes one off the shop without deleting it. The ones
 * that are off sit at the bottom, out of the order.
 */
export default function CollectionsList() {
  const can = useCan();
  const canWrite = can('products:write');
  const q = useCollections();
  const store = useStore();
  const [search, setSearch] = useState('');

  const menuOrder = useMemo(
    () => new Map((store.data?.menu ?? []).flatMap((m, i) => (m.collectionHandle ? [[m.collectionHandle, i] as const] : []))),
    [store.data],
  );
  const saved = useMemo(
    () =>
      [...(q.data ?? [])].sort(
        (a, b) =>
          Number(b.published) - Number(a.published) ||
          (menuOrder.get(a.handle) ?? 999) - (menuOrder.get(b.handle) ?? 999) ||
          a.title.localeCompare(b.title),
      ),
    [q.data, menuOrder],
  );

  /* What the screen shows while a row is being moved: the server hears about
     it on the drop, and this follows the server again afterwards. */
  const [order, setOrder] = useState(saved);
  useEffect(() => setOrder(saved), [saved]);
  const [dragging, setDragging] = useState<string | null>(null);
  /** the row the carried one is hovering, so the line shows where it lands */
  const [over, setOver] = useState<string | null>(null);

  const qc = useQueryClient();
  const toast = useToast();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.collections });
    void qc.invalidateQueries({ queryKey: qk.store });
    void qc.invalidateQueries({ queryKey: qk.publicCollections });
  };

  const reorder = useMutation({
    mutationFn: (handles: string[]) => put<void>('/api/admin/collections/order', { handles }),
    onSuccess: refresh,
    onError: () => setOrder(saved),
  });

  const available = useMutation({
    mutationFn: ({ id, published }: { id: string; published: boolean }) => patch<AdminCollectionDTO>(`/api/admin/collections/${id}`, { published }),
    onSuccess: (dto) => {
      refresh();
      toast.success(dto.published ? `${dto.title} is on the shop` : `${dto.title} is off the shop`);
    },
  });

  const searching = search.trim().length > 0;
  const rows = order.filter((c) => c.title.toLowerCase().includes(search.trim().toLowerCase()));
  const live = order.filter((c) => c.published);
  // both indexes read from the same list, so the line falls on the right edge
  const dragIndex = dragging ? live.findIndex((c) => c.handle === dragging) : -1;

  const move = (from: number, to: number) => {
    if (to < 0 || to >= live.length || from === to) return;
    const next = moveItem(live, from, to);
    setOrder([...next, ...order.filter((c) => !c.published)]);
    reorder.mutate(next.map((c) => c.handle));
  };

  const onDrop = (e: DragEvent, target: AdminCollectionDTO) => {
    e.preventDefault();
    const from = live.findIndex((c) => c.handle === dragging);
    const to = live.findIndex((c) => c.handle === target.handle);
    setDragging(null);
    setOver(null);
    if (from >= 0 && to >= 0) move(from, to);
  };

  const onGripKey = (e: KeyboardEvent, index: number) => {
    const to = e.key === 'ArrowUp' ? index - 1 : e.key === 'ArrowDown' ? index + 1 : null;
    if (to === null) return;
    e.preventDefault();
    move(index, to);
  };

  return (
    <>
      <PageHeader
        title="Collections"
        actions={
          canWrite ? (
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
              body="A collection is a list of pieces you choose — the categories on the shop are collections."
              action={canWrite ? <ButtonLink to="/admin/collections/new" variant="primary">Create collection</ButtonLink> : undefined}
            />
          ) : (
            <>
              <div className="adm-filters">
                <TextInput
                  label="Search collections"
                  labelHidden
                  type="search"
                  placeholder="Search collections"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="adm-filters__grow"
                />
              </div>
              <p className="adm-card__pad adm-field__hint">
                Every available collection is a category on the shop, in this order. Drag a row to move it; switch one off to take it off the shop
                without deleting it.
              </p>
              <ErrorBanner error={reorder.error ?? available.error} title="That did not save" />
              {rows.length === 0 ? (
                <EmptyState compact title="No collections match" />
              ) : (
                <ol className="adm-collections">
                  {rows.map((c) => {
                    const index = live.findIndex((x) => x.handle === c.handle);
                    const movable = canWrite && !searching && c.published && live.length > 1;
                    return (
                      <li
                        key={c.id}
                        className={[
                          'adm-collection',
                          c.published ? '' : 'adm-collection--off',
                          dragging === c.handle ? 'adm-collection--dragging' : '',
                          over === c.handle && dragging ? (dragIndex > index ? 'adm-collection--above' : 'adm-collection--below') : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        draggable={movable}
                        onDragStart={() => setDragging(c.handle)}
                        onDragEnd={() => {
                          setDragging(null);
                          setOver(null);
                        }}
                        onDragOver={(e) => {
                          if (!movable || !dragging || dragging === c.handle) return;
                          e.preventDefault();
                          setOver(c.handle);
                        }}
                        onDragLeave={() => setOver((h) => (h === c.handle ? null : h))}
                        onDrop={(e) => {
                          if (movable) onDrop(e, c);
                        }}
                      >
                        <button
                          type="button"
                          className="adm-collection__grip"
                          aria-label={`Reorder ${c.title} — drag, or use the arrow keys`}
                          title="Drag to reorder"
                          disabled={!movable}
                          onKeyDown={(e) => {
                            if (movable) onGripKey(e, index);
                          }}
                        >
                          <IconMenu size={14} />
                        </button>
                        <span className="adm-collection__pos">{c.published ? String(index + 1).padStart(2, '0') : '—'}</span>
                        <span className="adm-collection__main">
                          <Link to={`/admin/collections/${c.id}`} className="adm-link-strong">
                            {c.title}
                          </Link>
                          <span className="adm-collection__meta">
                            {c.productsCount.toLocaleString()} {c.productsCount === 1 ? 'piece' : 'pieces'} · updated {fmtDate(c.updatedAt)}
                          </span>
                        </span>
                        <span className="adm-collection__status">
                          <span className="adm-collection__statustext">{c.published ? 'Available' : 'Off the shop'}</span>
                          <Toggle
                            label={`${c.title} is available`}
                            labelHidden
                            checked={c.published}
                            disabled={!canWrite || available.isPending}
                            onChange={(published) => available.mutate({ id: c.id, published })}
                          />
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </>
          )
        ) : (
          <div className="adm-card__pad">
            <QueryState error={q.error ?? store.error} isPending={q.isPending} onRetry={() => void q.refetch()} />
          </div>
        )}
      </Card>
    </>
  );
}
