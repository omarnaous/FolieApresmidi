import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { del, PageInput, post, put, type AdminPageDTO } from '../../lib/contract';
import { apiFieldErrors, validate, type FieldErrors } from '../../lib/forms';
import { fmtDateTime } from '../../lib/format';
import { useUnsavedChanges } from '../../lib/hooks';
import { qk, usePage } from '../../lib/queries';
import { sameJson, slugify } from '../../lib/util';
import { Button } from '../../ui/Button';
import { ErrorBanner, FormErrorSummary, QueryState } from '../../ui/feedback';
import { ChoiceGroup, TextInput, Toggle } from '../../ui/form';
import { HtmlField } from '../../ui/HtmlField';
import { Card, PageHeader, SaveBar } from '../../ui/layout';
import { ConfirmDialog } from '../../ui/Modal';
import { SeoCard } from '../../ui/SeoCard';
import { useToast } from '../../ui/Toasts';

const BACK = { to: '/admin/pages', label: 'Pages' };

interface PageDraft {
  title: string;
  handle: string;
  handleTouched: boolean;
  kind: 'policy' | 'page';
  bodyHtml: string;
  published: boolean;
  seoTitle: string;
  seoDescription: string;
}

const fromDTO = (p: AdminPageDTO): PageDraft => ({
  title: p.title,
  handle: p.handle,
  handleTouched: true,
  kind: p.kind,
  bodyHtml: p.bodyHtml,
  published: p.published,
  seoTitle: p.seoTitle ?? '',
  seoDescription: p.seoDescription ?? '',
});

const EMPTY: PageDraft = { title: '', handle: '', handleTouched: false, kind: 'page', bodyHtml: '', published: true, seoTitle: '', seoDescription: '' };

export default function PageEditor() {
  const { id } = useParams();
  const page = usePage(id);
  if (id && !page.data) {
    return (
      <>
        <PageHeader title="Page" back={BACK} />
        <QueryState error={page.error} isPending={page.isPending} onRetry={() => void page.refetch()} />
      </>
    );
  }
  return <PageForm key={id ?? 'new'} page={page.data ?? null} />;
}

function PageForm({ page }: { page: AdminPageDTO | null }) {
  const isNew = !page;
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [base, setBase] = useState<PageDraft>(() => (page ? fromDTO(page) : EMPTY));
  const [draft, setDraft] = useState<PageDraft>(base);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty = !sameJson(base, draft);
  useUnsavedChanges(dirty);
  const set = <K extends keyof PageDraft>(k: K, v: PageDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.pages, exact: true });
    void qc.invalidateQueries({ queryKey: qk.store });
  };

  const save = useMutation({
    mutationFn: (body: PageInput) => (page ? put<AdminPageDTO>(`/api/admin/pages/${page.id}`, body) : post<AdminPageDTO>('/api/admin/pages', body)),
    onSuccess: (dto) => {
      qc.setQueryData(qk.page(dto.id), dto);
      invalidate();
      const next = fromDTO(dto);
      setBase(next);
      setDraft(next);
      setErrors({});
      toast.success(isNew ? 'Page created' : 'Page saved');
      if (isNew) navigate(`/admin/pages/${dto.id}`, { replace: true });
    },
    onError: (err) => setErrors(apiFieldErrors(err)),
  });

  const remove = useMutation({
    mutationFn: () => del<void>(`/api/admin/pages/${page?.id}`),
    onSuccess: () => {
      invalidate();
      toast.success('Page deleted');
      setBase(draft);
      navigate('/admin/pages', { replace: true });
    },
  });

  const submit = () => {
    if (save.isPending) return;
    const body: PageInput = {
      title: draft.title,
      handle: draft.handle.trim() || undefined,
      kind: draft.kind,
      bodyHtml: draft.bodyHtml,
      published: draft.published,
      seoTitle: draft.seoTitle.trim() || null,
      seoDescription: draft.seoDescription.trim() || null,
    };
    const invalid = validate(PageInput, body);
    setErrors(invalid ?? {});
    if (invalid) return window.scrollTo({ top: 0 });
    save.mutate(body);
  };

  return (
    <>
      <PageHeader
        title={isNew ? 'Add page' : base.title || 'Untitled page'}
        back={BACK}
        meta={page ? <span className="adm-muted">Updated {fmtDateTime(page.updatedAt)}</span> : undefined}
        actions={
          page ? (
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          ) : undefined
        }
      />
      <FormErrorSummary errors={save.error ? {} : errors} />
      <ErrorBanner error={save.error} title="The page was not saved" />

      <div className="adm-split">
        <div className="adm-split__main">
          <Card title="Content">
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
              <HtmlField label="Body" value={draft.bodyHtml} error={errors.bodyHtml} rows={18} onChange={(v) => set('bodyHtml', v)} />
            </div>
          </Card>
        </div>
        <div className="adm-split__side">
          <Card title="Visibility">
            <div className="adm-stack">
              <Toggle label="Published" hint="Hidden pages return “not found” in the store." checked={draft.published} onChange={(v) => set('published', v)} />
              <ChoiceGroup
                label="Kind"
                value={draft.kind}
                onChange={(v) => set('kind', v)}
                options={[
                  { value: 'page', label: 'Page', description: 'About, care guide, stockists…' },
                  { value: 'policy', label: 'Policy', description: 'Listed with the store policies and linked at checkout.' },
                ]}
              />
            </div>
          </Card>
          <SeoCard
            pathPrefix="/pages/"
            handle={draft.handle}
            onHandle={(v) => setDraft((d) => ({ ...d, handle: v, handleTouched: true }))}
            seoTitle={draft.seoTitle}
            onSeoTitle={(v) => set('seoTitle', v)}
            seoDescription={draft.seoDescription}
            onSeoDescription={(v) => set('seoDescription', v)}
            fallbackTitle={draft.title}
            fallbackDescription={draft.bodyHtml}
            errors={errors}
          />
        </div>
      </div>

      <SaveBar dirty={dirty} saving={save.isPending} onSave={submit} onDiscard={() => { setDraft(base); setErrors({}); }} saveLabel={isNew ? 'Create page' : 'Save'} />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${base.title || 'this page'}?`}
        body="Links to this page will stop working. This cannot be undone."
        confirmLabel="Delete page"
        tone="danger"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
