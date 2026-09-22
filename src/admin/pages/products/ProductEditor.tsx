import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { del, post, put, PRODUCT_STATUSES, type AdminProductDTO, type AdminProductInput, type MediaDTO } from '../../lib/contract';
import { apiFieldErrors, type FieldErrors } from '../../lib/forms';
import { PRODUCT_STATUS_META } from '../../lib/format';
import { useUnsavedChanges } from '../../lib/hooks';
import { qk, useCollections, useProduct, useStore } from '../../lib/queries';
import { useCan } from '../../lib/session';
import { sameJson, slugify } from '../../lib/util';
import { Button, ButtonLink } from '../../ui/Button';
import { Banner, ErrorBanner, FormErrorSummary, ProductStatusBadge, QueryState } from '../../ui/feedback';
import { Select, TextInput, Toggle } from '../../ui/form';
import { HtmlField } from '../../ui/HtmlField';
import { IconExternal } from '../../ui/icons';
import { Card, PageHeader, SaveBar } from '../../ui/layout';
import { ConfirmDialog } from '../../ui/Modal';
import { SeoCard } from '../../ui/SeoCard';
import { useToast } from '../../ui/Toasts';
import { LookCard } from './LookCard';
import { MediaCard } from './MediaCard';
import { OptionsCard } from './OptionsCard';
import { buildPayload, emptyDraft, fromDTO, syncVariants, type OptionDraft, type ProductDraft } from './productDraft';
import { VariantsCard } from './VariantsCard';

const BACK = { to: '/admin/products', label: 'Products' };

export default function ProductEditor() {
  const { id } = useParams();
  const product = useProduct(id);
  const store = useStore();
  if ((id && !product.data) || !store.data) {
    return (
      <>
        <PageHeader title={id ? 'Product' : 'Add product'} back={BACK} />
        <QueryState
          error={product.error ?? store.error}
          isPending
          onRetry={() => {
            void product.refetch();
            void store.refetch();
          }}
        />
      </>
    );
  }
  return <ProductForm key={id ?? 'new'} product={product.data ?? null} currency={store.data.currency} />;
}

function ProductForm({ product, currency }: { product: AdminProductDTO | null; currency: string }) {
  const isNew = !product;
  const can = useCan();
  const canWrite = can('products:write');
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [base, setBase] = useState<ProductDraft>(() => (product ? fromDTO(product) : emptyDraft()));
  const [draft, setDraft] = useState<ProductDraft>(base);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty = !sameJson(base, draft);
  useUnsavedChanges(dirty && canWrite);

  const set = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setOptions = (next: OptionDraft[]) => setDraft((d) => ({ ...d, options: next, variants: syncVariants(d.options, next, d.variants) }));
  const setMedia = (update: (media: MediaDTO[]) => MediaDTO[]) =>
    setDraft((d) => {
      const media = update(d.media);
      const ids = new Set(media.map((m) => m.id));
      return { ...d, media, variants: d.variants.map((v) => (v.imageId && !ids.has(v.imageId) ? { ...v, imageId: null } : v)) };
    });

  const invalidateLists = () => {
    void qc.invalidateQueries({ queryKey: qk.products, predicate: (q) => q.queryKey[2] !== 'detail' });
    void qc.invalidateQueries({ queryKey: qk.collections });
    void qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
  };

  const save = useMutation({
    mutationFn: (payload: AdminProductInput) =>
      product ? put<AdminProductDTO>(`/api/admin/products/${product.id}`, payload) : post<AdminProductDTO>('/api/admin/products', payload),
    onSuccess: (dto) => {
      qc.setQueryData(qk.product(dto.id), dto);
      invalidateLists();
      const next = fromDTO(dto);
      setBase(next);
      setDraft(next);
      setErrors({});
      toast.success(isNew ? 'Product created' : 'Product saved');
      if (isNew) navigate(`/admin/products/${dto.id}`, { replace: true });
    },
    onError: (err) => setErrors(apiFieldErrors(err)),
  });

  const remove = useMutation({
    mutationFn: () => del<void>(`/api/admin/products/${product?.id}`),
    onSuccess: () => {
      if (product) qc.removeQueries({ queryKey: qk.product(product.id) });
      invalidateLists();
      toast.success('Product deleted');
      setBase(draft);
      navigate('/admin/products', { replace: true });
    },
  });

  const submit = () => {
    if (save.isPending) return;
    const { payload, errors: errs } = buildPayload(draft);
    setErrors(errs);
    if (Object.keys(errs).length) {
      window.scrollTo({ top: 0 });
      return;
    }
    save.mutate(payload);
  };

  return (
    <>
      <PageHeader
        title={isNew ? 'Add product' : base.title || 'Untitled product'}
        back={BACK}
        meta={product ? <ProductStatusBadge status={product.status} /> : undefined}
        actions={
          product ? (
            <>
              {product.status === 'active' && (
                <ButtonLink to={`/products/${product.handle}`} native target="_blank" rel="noopener" icon={<IconExternal size={14} />}>
                  View in store
                </ButtonLink>
              )}
              {canWrite && (
                <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              )}
            </>
          ) : undefined
        }
      />

      {!canWrite && <Banner tone="info">You can view this product but not edit it.</Banner>}
      <FormErrorSummary errors={save.error ? {} : errors} />
      <ErrorBanner error={save.error} title="The product was not saved" />

      <fieldset className="adm-fieldset" disabled={!canWrite}>
        <div className="adm-split">
          <div className="adm-split__main">
            <Card title="Details">
              <div className="adm-stack">
                <TextInput
                  label="Title"
                  value={draft.title}
                  error={errors.title}
                  maxLength={200}
                  onChange={(e) => {
                    const title = e.target.value;
                    setDraft((d) => ({ ...d, title, handle: d.handleTouched ? d.handle : slugify(title) }));
                  }}
                  autoFocus={isNew}
                />
                <HtmlField label="Description" value={draft.descriptionHtml} error={errors.descriptionHtml} onChange={(v) => set('descriptionHtml', v)} />
              </div>
            </Card>

            <MediaCard media={draft.media} onChange={(next) => setMedia(() => next)} onAdd={(items) => setMedia((m) => [...m, ...items.filter((n) => !m.some((x) => x.id === n.id))].slice(0, 50))} onAltSaved={(m) => {
              const patchAlt = (d: ProductDraft) => ({ ...d, media: d.media.map((x) => (x.id === m.id ? m : x)) });
              setBase(patchAlt);
              setDraft(patchAlt);
            }} error={errors.mediaIds} />

            <OptionsCard options={draft.options} errors={errors} onChange={setOptions} />

            <VariantsCard variants={draft.variants} media={draft.media} currency={currency} errors={errors} onChange={(variants) => set('variants', variants)} />

            <LookCard pieces={draft.look} productId={product?.id ?? null} error={errors.lookProductIds} onChange={(look) => set('look', look)} />
          </div>

          <div className="adm-split__side">
            <Card title="Status">
              <Select label="Product status" labelHidden value={draft.status} onChange={(e) => set('status', e.target.value as ProductDraft['status'])} error={errors.status}>
                {PRODUCT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {PRODUCT_STATUS_META[s].label}
                  </option>
                ))}
              </Select>
              <p className="adm-field__hint">
                {draft.status === 'active' ? 'Visible in the store.' : draft.status === 'draft' ? 'Hidden until you set it active.' : 'Hidden and kept for records.'}
              </p>
            </Card>

            <Card title="Where it belongs">
              <Toggle
                label="An accessory"
                hint="Shown in the accessories section rather than the boutique, and photographed on grey."
                checked={draft.isAccessory}
                onChange={(on) => set('isAccessory', on)}
              />
            </Card>

            <CollectionsCard selected={draft.collectionIds} onChange={(ids) => set('collectionIds', ids)} />

            <SeoCard
              pathPrefix="/products/"
              handle={draft.handle}
              onHandle={(v) => setDraft((d) => ({ ...d, handle: v, handleTouched: true }))}
              seoTitle={draft.seoTitle}
              onSeoTitle={(v) => set('seoTitle', v)}
              seoDescription={draft.seoDescription}
              onSeoDescription={(v) => set('seoDescription', v)}
              fallbackTitle={draft.title}
              fallbackDescription={draft.descriptionHtml}
              errors={errors}
            />
          </div>
        </div>
      </fieldset>

      {canWrite && <SaveBar dirty={dirty} saving={save.isPending} onSave={submit} onDiscard={() => { setDraft(base); setErrors({}); }} saveLabel={isNew ? 'Create product' : 'Save'} />}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${base.title || 'this product'}?`}
        body="The product, its variants and stock records are removed. Past orders keep their line items. This cannot be undone."
        confirmLabel="Delete product"
        tone="danger"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}

/** Which collections this piece belongs to. Every collection is a list someone picks by hand. */
function CollectionsCard({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const collections = useCollections();
  const [filter, setFilter] = useState('');
  const all = collections.data ?? [];
  const shown = all.filter((c) => c.title.toLowerCase().includes(filter.trim().toLowerCase()));
  return (
    <Card title="Collections">
      {collections.error ? (
        <ErrorBanner error={collections.error} onRetry={() => void collections.refetch()} />
      ) : collections.isPending ? (
        <p className="adm-muted">Loading collections…</p>
      ) : all.length === 0 ? (
        <p className="adm-muted">No collections yet.</p>
      ) : (
        <fieldset className="adm-checklist">
          <legend className="adm-sr">Collections</legend>
          {all.length > 8 && <TextInput label="Filter collections" labelHidden type="search" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />}
          <ul className="adm-checklist__list">
            {shown.map((c) => (
              <li key={c.id}>
                <label className="adm-checklist__row">
                  <input
                    type="checkbox"
                    checked={selected.includes(c.id)}
                    onChange={(e) => onChange(e.target.checked ? [...selected, c.id] : selected.filter((x) => x !== c.id))}
                  />
                  <span>{c.title}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
    </Card>
  );
}
