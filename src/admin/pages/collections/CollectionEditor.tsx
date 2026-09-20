import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  AdminCollectionInput,
  COLLECTION_SORTS,
  del,
  imageSrc,
  post,
  put,
  type AdminCollectionDTO,
  type AdminProductListItemDTO,
  type CollectionRuleField,
  type CollectionRuleOp,
  type CollectionSort,
  type MediaDTO,
} from '../../lib/contract';
import { apiFieldErrors, validate, type FieldErrors } from '../../lib/forms';
import { useUnsavedChanges } from '../../lib/hooks';
import { qk, useCollection, useStore, type AdminCollectionDetail } from '../../lib/queries';
import { useCan } from '../../lib/session';
import { clientKey, moveItem, sameJson, slugify } from '../../lib/util';
import { Button, IconButton } from '../../ui/Button';
import { Banner, EmptyState, ErrorBanner, FormErrorSummary, ProductStatusBadge, QueryState } from '../../ui/feedback';
import { ChoiceGroup, MoneyInput, Select, TextInput, Toggle } from '../../ui/form';
import { HtmlField } from '../../ui/HtmlField';
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from '../../ui/icons';
import { Card, PageHeader, SaveBar } from '../../ui/layout';
import { SingleImageField } from '../../ui/media';
import { ConfirmDialog } from '../../ui/Modal';
import { ProductPicker } from '../../ui/Pickers';
import { SeoCard } from '../../ui/SeoCard';
import { Thumb } from '../../ui/Table';
import { useToast } from '../../ui/Toasts';

const BACK = { to: '/admin/collections', label: 'Collections' };

const FIELD_LABELS: Record<CollectionRuleField, string> = {
  tag: 'Product tag',
  product_type: 'Product type',
  vendor: 'Vendor',
  title: 'Product title',
  price: 'Price',
  in_stock: 'In stock',
};
const FIELD_OPS: Record<CollectionRuleField, CollectionRuleOp[]> = {
  tag: ['eq', 'neq'],
  product_type: ['eq', 'neq'],
  vendor: ['eq', 'neq'],
  title: ['contains', 'eq', 'neq'],
  price: ['lt', 'gt'],
  in_stock: ['eq'],
};
const OP_LABELS: Record<CollectionRuleOp, string> = { eq: 'is equal to', neq: 'is not equal to', contains: 'contains', lt: 'is less than', gt: 'is greater than' };
const SORT_LABELS: Record<CollectionSort, string> = {
  manual: 'Manual order',
  best_selling: 'Best selling',
  price_asc: 'Price, low to high',
  price_desc: 'Price, high to low',
  created_desc: 'Newest first',
  title_asc: 'Title, A–Z',
};

interface CollectionDraft {
  title: string;
  handle: string;
  handleTouched: boolean;
  descriptionHtml: string;
  sort: CollectionSort;
  image: MediaDTO | null;
  published: boolean;
  seoTitle: string;
  seoDescription: string;
}

const fromDTO = (c: AdminCollectionDTO): CollectionDraft => ({
  title: c.title,
  handle: c.handle,
  handleTouched: true,
  descriptionHtml: c.descriptionHtml,
  sort: c.sort,
  image: c.image,
  published: c.published,
  seoTitle: c.seoTitle ?? '',
  seoDescription: c.seoDescription ?? '',
});

const emptyDraft = (): CollectionDraft => ({
  title: '',
  handle: '',
  handleTouched: false,
  descriptionHtml: '',
  sort: 'manual',
  image: null,
  published: true,
  seoTitle: '',
  seoDescription: '',
});

export default function CollectionEditor() {
  const { id } = useParams();
  const collection = useCollection(id);
  const store = useStore();
  if ((id && !collection.data) || !store.data) {
    return (
      <>
        <PageHeader title={id ? 'Collection' : 'Create collection'} back={BACK} />
        <QueryState error={collection.error ?? store.error} isPending onRetry={() => void collection.refetch()} />
      </>
    );
  }
  return <CollectionForm key={id ?? 'new'} collection={collection.data ?? null} currency={store.data.currency} />;
}

function CollectionForm({ collection, currency }: { collection: AdminCollectionDetail | null; currency: string }) {
  const isNew = !collection;
  const can = useCan();
  const canWrite = can('products:write');
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [base, setBase] = useState<CollectionDraft>(() => (collection ? fromDTO(collection) : emptyDraft()));
  const [draft, setDraft] = useState<CollectionDraft>(base);
  const [baseProducts, setBaseProducts] = useState<AdminProductListItemDTO[]>(collection?.products ?? []);
  const [products, setProducts] = useState<AdminProductListItemDTO[]>(baseProducts);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [picking, setPicking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const productsDirty = !sameJson(baseProducts.map((p) => p.id), products.map((p) => p.id));
  const dirty = !sameJson(base, draft) || productsDirty;
  useUnsavedChanges(dirty && canWrite);
  const set = <K extends keyof CollectionDraft>(k: K, v: CollectionDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.collections });
    void qc.invalidateQueries({ queryKey: qk.products });
    void qc.invalidateQueries({ queryKey: qk.publicCollections });
  };

  const save = useMutation({
    mutationFn: async ({ payload, productIds }: { payload: AdminCollectionInput; productIds: string[] | null }) => {
      const dto = collection
        ? await put<AdminCollectionDTO>(`/api/admin/collections/${collection.id}`, payload)
        : await post<AdminCollectionDTO>('/api/admin/collections', payload);
      let productsError: unknown = null;
      if (productIds) {
        try {
          await put<void>(`/api/admin/collections/${dto.id}/products`, { productIds });
        } catch (err) {
          productsError = err;
        }
      }
      return { dto, productsError };
    },
    onSuccess: ({ dto, productsError }) => {
      invalidate();
      const next = fromDTO(dto);
      setBase(next);
      setDraft(next);
      setErrors({});
      if (!productsError) setBaseProducts(products);
      if (productsError) toast.error('Collection saved, but its product list could not be updated. Try saving again.');
      else toast.success(isNew ? 'Collection created' : 'Collection saved');
      if (isNew) navigate(`/admin/collections/${dto.id}`, { replace: true });
    },
    onError: (err) => setErrors(apiFieldErrors(err)),
  });

  const remove = useMutation({
    mutationFn: () => del<void>(`/api/admin/collections/${collection?.id}`),
    onSuccess: () => {
      invalidate();
      toast.success('Collection deleted');
      setBase(draft);
      setBaseProducts(products);
      navigate('/admin/collections', { replace: true });
    },
  });

  const submit = () => {
    if (save.isPending) return;
    const payload: AdminCollectionInput = {
      title: draft.title,
      handle: draft.handle.trim() || undefined,
      descriptionHtml: draft.descriptionHtml,
      sort: draft.sort,
      imageId: draft.image?.id ?? null,
      published: draft.published,
      seoTitle: draft.seoTitle.trim() || null,
      seoDescription: draft.seoDescription.trim() || null,
    };
    const errs = validate(AdminCollectionInput, payload) ?? {};
    setErrors(errs);
    if (Object.keys(errs).length) return window.scrollTo({ top: 0 });
    save.mutate({ payload, productIds: productsDirty || (isNew && products.length > 0) ? products.map((p) => p.id) : null });
  };

  return (
    <>
      <PageHeader
        title={isNew ? 'Create collection' : base.title || 'Untitled collection'}
        back={BACK}
        actions={
          collection && canWrite ? (
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          ) : undefined
        }
      />
      {!canWrite && <Banner tone="info">You can view this collection but not edit it.</Banner>}
      <FormErrorSummary errors={save.error ? {} : errors} />
      <ErrorBanner error={save.error} title="The collection was not saved" />

      <fieldset className="adm-fieldset" disabled={!canWrite}>
        <div className="adm-split">
          <div className="adm-split__main">
            <Card title="Details">
              <div className="adm-stack">
                <TextInput
                  label="Title"
                  value={draft.title}
                  maxLength={200}
                  error={errors.title}
                  onChange={(e) => {
                    const title = e.target.value;
                    setDraft((d) => ({ ...d, title, handle: d.handleTouched ? d.handle : slugify(title) }));
                  }}
                  autoFocus={isNew}
                />
                <HtmlField label="Description" value={draft.descriptionHtml} error={errors.descriptionHtml} rows={6} onChange={(v) => set('descriptionHtml', v)} />
              </div>
            </Card>

            <Card
              title={`Products · ${products.length}`}
              flush
              actions={
                <Button size="sm" icon={<IconPlus size={14} />} onClick={() => setPicking(true)}>
                  Add products
                </Button>
              }
            >
              {products.length === 0 ? (
                <EmptyState compact title="No products in this collection" body="Choose the pieces that belong here." action={<Button variant="primary" onClick={() => setPicking(true)}>Add products</Button>} />
              ) : (
                <ol className="adm-orderlist">
                    {products.map((p, i) => (
                      <li key={p.id} className="adm-orderlist__item">
                        <span className="adm-orderlist__pos">{i + 1}</span>
                        <Thumb src={p.image ? imageSrc(p.image, 320) : null} size={36} />
                        <Link to={`/admin/products/${p.id}`} className="adm-link-strong adm-orderlist__title">
                          {p.title}
                        </Link>
                        <ProductStatusBadge status={p.status} />
                        <span className="adm-row adm-row--tight">
                          <IconButton label={`Move ${p.title} up`} disabled={i === 0} onClick={() => setProducts(moveItem(products, i, i - 1))}>
                            <IconArrowUp size={14} />
                          </IconButton>
                          <IconButton label={`Move ${p.title} down`} disabled={i === products.length - 1} onClick={() => setProducts(moveItem(products, i, i + 1))}>
                            <IconArrowDown size={14} />
                          </IconButton>
                          <IconButton label={`Remove ${p.title} from collection`} tone="danger" onClick={() => setProducts(products.filter((x) => x.id !== p.id))}>
                            <IconTrash size={14} />
                          </IconButton>
                        </span>
                      </li>
                    ))}
                  </ol>
              )}
            </Card>
          </div>

          <div className="adm-split__side">
            <Card title="Visibility">
              <Toggle
                label="Available"
                hint="On the shop as one of its categories. Switched off, it keeps its pieces but leaves the site."
                checked={draft.published}
                onChange={(v) => set('published', v)}
              />
            </Card>
            <Card title="Sorting">
              <Select label="Sort products by" value={draft.sort} error={errors.sort} onChange={(e) => set('sort', e.target.value as CollectionSort)}>
                {COLLECTION_SORTS.map((s) => (
                  <option key={s} value={s}>
                    {SORT_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Card>
            <Card title="Image">
              <SingleImageField label="Collection image" value={draft.image} onChange={(m) => set('image', m)} />
            </Card>
            <SeoCard
              pathPrefix="/collections/"
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

      {canWrite && (
        <SaveBar
          dirty={dirty}
          saving={save.isPending}
          onSave={submit}
          onDiscard={() => {
            setDraft(base);
            setProducts(baseProducts);
            setErrors({});
          }}
          saveLabel={isNew ? 'Create collection' : 'Save'}
        />
      )}

      <ProductPicker open={picking} onClose={() => setPicking(false)} excludeIds={products.map((p) => p.id)} onSelect={(items) => setProducts([...products, ...items])} />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${base.title || 'this collection'}?`}
        body="Products stay in your catalogue; only the collection is removed. This cannot be undone."
        confirmLabel="Delete collection"
        tone="danger"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
