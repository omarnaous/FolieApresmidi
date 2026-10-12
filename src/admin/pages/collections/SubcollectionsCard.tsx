import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { MAX_CATEGORIES, put, type AdminCategoryDTO, type CategoriesInput } from '../../lib/contract';
import { apiFieldErrors, type FieldErrors } from '../../lib/forms';
import { qk, useCategories } from '../../lib/queries';
import { clientKey, moveItem, plural, sameJson } from '../../lib/util';
import { Button, IconButton } from '../../ui/Button';
import { ErrorBanner, QueryState } from '../../ui/feedback';
import { TextInput } from '../../ui/form';
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from '../../ui/icons';
import { Card } from '../../ui/layout';
import { ConfirmDialog } from '../../ui/Modal';
import { useToast } from '../../ui/Toasts';

interface Row {
  key: string;
  name: string;
  /** the name it was loaded with; null for a new one */
  previous: string | null;
  count: number;
}

const rowsOf = (items: AdminCategoryDTO[]): Row[] => items.map((c) => ({ key: clientKey('c'), name: c.name, previous: c.name, count: c.count }));
const plain = (rows: Row[]) => rows.map((r) => ({ name: r.name.trim(), previous: r.previous }));

/**
 * The subcollections — Tops, Bottoms, Jackets… — that every collection is
 * divided into. Their names and order are what the shop's Boutique menu and
 * its filters show. Renaming one renames it on every piece; taking one out
 * takes it off its pieces.
 */
export function SubcollectionsCard({ canWrite }: { canWrite: boolean }) {
  const q = useCategories();
  const qc = useQueryClient();
  const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [confirm, setConfirm] = useState(false);

  // the list as loaded, until it is edited
  useEffect(() => {
    if (q.data && rows === null) setRows(rowsOf(q.data));
  }, [q.data, rows]);

  const base = q.data ? rowsOf(q.data) : [];
  const live = rows ?? base;
  const dirty = !!q.data && !sameJson(plain(live), plain(base));
  // the ones taken out that still hold pieces
  const dropped = base.filter((b) => b.count > 0 && !live.some((r) => r.previous === b.previous));

  const save = useMutation({
    mutationFn: (body: CategoriesInput) => put<{ items: AdminCategoryDTO[] }>('/api/admin/categories', body),
    onSuccess: (res) => {
      qc.setQueryData(qk.categories, res);
      setRows(rowsOf(res.items));
      setErrors({});
      setConfirm(false);
      toast.success('Subcollections saved');
      void qc.invalidateQueries({ queryKey: qk.products });
      void qc.invalidateQueries({ queryKey: qk.home });
    },
    onError: (err) => {
      setErrors(apiFieldErrors(err));
      setConfirm(false);
    },
  });

  const set = (key: string, name: string) => setRows(live.map((r) => (r.key === key ? { ...r, name } : r)));
  const submit = () => save.mutate({ categories: plain(live) });

  return (
    <Card
      title="Subcollections"
      actions={
        canWrite && live.length < MAX_CATEGORIES ? (
          <Button size="sm" icon={<IconPlus size={14} />} onClick={() => setRows([...live, { key: clientKey('c'), name: '', previous: null, count: 0 }])}>
            Add subcollection
          </Button>
        ) : undefined
      }
    >
      <p className="adm-muted">
        Every collection is divided into these — the Boutique menu lists them, and the shop filters by them. Renaming one renames it on all its pieces; removing one takes it off them. A piece’s subcollection is set on the piece.
      </p>
      {!q.data ? (
        <QueryState error={q.error} isPending={q.isPending} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <ol className="adm-subcols">
            {live.map((r, i) => (
              <li key={r.key} className="adm-subcol">
                <span className="adm-subcol__num" aria-hidden="true">{i + 1}</span>
                <TextInput
                  label={`Subcollection ${i + 1} name`}
                  labelHidden
                  placeholder="Jackets"
                  value={r.name}
                  maxLength={40}
                  disabled={!canWrite}
                  error={errors[`categories.${i}.name`]}
                  onChange={(e) => set(r.key, e.target.value)}
                />
                <span className="adm-muted adm-subcol__count">
                  {r.previous === null ? 'New' : plural(r.count, 'piece')}
                  {r.previous !== null && r.name.trim() && r.name.trim() !== r.previous ? ` · was ${r.previous}` : ''}
                </span>
                {canWrite && (
                  <span className="adm-row adm-row--tight">
                    <IconButton label={`Move ${r.name || 'subcollection'} up`} disabled={i === 0} onClick={() => setRows(moveItem(live, i, i - 1))}>
                      <IconArrowUp size={15} />
                    </IconButton>
                    <IconButton label={`Move ${r.name || 'subcollection'} down`} disabled={i === live.length - 1} onClick={() => setRows(moveItem(live, i, i + 1))}>
                      <IconArrowDown size={15} />
                    </IconButton>
                    <IconButton label={`Remove ${r.name || 'subcollection'}`} tone="danger" onClick={() => setRows(live.filter((x) => x.key !== r.key))}>
                      <IconTrash size={15} />
                    </IconButton>
                  </span>
                )}
              </li>
            ))}
          </ol>
          {errors.categories && <p className="adm-field__error">{errors.categories}</p>}
          {save.isError && !Object.keys(errors).length && <ErrorBanner error={save.error} />}
          {canWrite && dirty && (
            <div className="adm-row adm-gap-top">
              <Button variant="primary" size="sm" loading={save.isPending} onClick={() => (dropped.length ? setConfirm(true) : submit())}>
                Save subcollections
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setRows(base); setErrors({}); }}>
                Discard
              </Button>
            </div>
          )}
        </>
      )}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Remove ${dropped.map((d) => d.previous).join(', ')}?`}
        body={`${plural(dropped.reduce((n, d) => n + d.count, 0), 'piece')} will have no subcollection until you give them one. The pieces themselves stay in the shop.`}
        confirmLabel="Remove and save"
        tone="danger"
        pending={save.isPending}
        onConfirm={submit}
      />
    </Card>
  );
}
