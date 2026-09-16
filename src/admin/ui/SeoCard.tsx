import type { FieldErrors } from '../lib/forms';
import { CharCount, Textarea, TextInput } from './form';
import { Card } from './layout';

/** Handle + SEO title/description with a search-result preview. */
export function SeoCard({
  pathPrefix,
  handle,
  onHandle,
  seoTitle,
  onSeoTitle,
  seoDescription,
  onSeoDescription,
  fallbackTitle,
  fallbackDescription,
  errors,
}: {
  pathPrefix: string;
  handle: string;
  onHandle: (v: string) => void;
  seoTitle: string;
  onSeoTitle: (v: string) => void;
  seoDescription: string;
  onSeoDescription: (v: string) => void;
  fallbackTitle: string;
  fallbackDescription?: string;
  errors: FieldErrors;
}) {
  const shownTitle = seoTitle.trim() || fallbackTitle.trim() || 'Untitled';
  const shownDesc = (seoDescription.trim() || fallbackDescription?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || '').slice(0, 160);
  return (
    <Card title="Search engine listing">
      <div className="adm-serp">
        <p className="adm-label adm-muted">Preview</p>
        <p className="adm-serp__url">
          {window.location.host}
          {pathPrefix}
          {handle || '…'}
        </p>
        <p className="adm-serp__title">{shownTitle}</p>
        {shownDesc && <p className="adm-serp__desc">{shownDesc}</p>}
      </div>
      <div className="adm-stack">
        <TextInput
          label="URL handle"
          prefix={pathPrefix}
          value={handle}
          error={errors.handle}
          hint="Lowercase letters, digits and dashes."
          spellCheck={false}
          autoCapitalize="none"
          onChange={(e) => onHandle(e.target.value)}
        />
        <TextInput label="Page title" value={seoTitle} maxLength={200} aside={<CharCount value={seoTitle} max={70} />} error={errors.seoTitle} onChange={(e) => onSeoTitle(e.target.value)} />
        <Textarea
          label="Meta description"
          rows={3}
          maxLength={320}
          value={seoDescription}
          aside={<CharCount value={seoDescription} max={320} />}
          error={errors.seoDescription}
          onChange={(e) => onSeoDescription(e.target.value)}
        />
      </div>
    </Card>
  );
}
