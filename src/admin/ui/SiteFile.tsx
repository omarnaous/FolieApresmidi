import { useId, useRef, useState } from 'react';
import { api, type MediaDTO, type SiteFileDTO } from '../lib/contract';
import { Button, Spinner } from './Button';
import { ErrorBanner } from './feedback';
import { IconTrash, IconUpload } from './icons';

const MAX_BYTES = 80 * 1024 * 1024;
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * The two files the site itself uses: the opening film and the notebook.
 * One file, uploaded straight to R2 through POST /api/admin/site-files, and
 * shown back as what it is — the film plays, the notebook opens.
 */
export function SiteFileField({
  label,
  hint,
  kind,
  value,
  onChange,
  error,
}: {
  label: string;
  hint?: string;
  kind: 'video' | 'pdf';
  /** the saved file, as the home page carries it */
  value: MediaDTO | null;
  onChange: (file: MediaDTO | null) => void;
  error?: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<unknown>(null);
  const [refused, setRefused] = useState<string | null>(null);

  const accept = kind === 'video' ? 'video/mp4,.mp4' : 'application/pdf,.pdf';
  const what = kind === 'video' ? 'an MP4 video' : 'a PDF';

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setFailed(null);
    setRefused(null);
    const looksRight = kind === 'video' ? /\.mp4$|^video\/mp4$/i.test(`${file.name}${file.type}`) : /\.pdf$|^application\/pdf$/i.test(`${file.name}${file.type}`);
    if (!looksRight) return setRefused(`${file.name} is not ${what}.`);
    if (file.size > MAX_BYTES) return setRefused(`${file.name} is ${mb(file.size)} — the limit is 80 MB.`);

    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const uploaded = await api<SiteFileDTO>('/api/admin/site-files', { method: 'POST', body: fd });
      onChange({ id: uploaded.id, url: uploaded.url, alt: uploaded.name, width: null, height: null });
    } catch (e) {
      setFailed(e);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="adm-field">
      <div className="adm-field__top">
        <span className="adm-field__label">{label}</span>
        {value && (
          <Button size="sm" variant="link" icon={<IconTrash size={13} />} onClick={() => onChange(null)}>
            Remove
          </Button>
        )}
      </div>

      {value ? (
        <div className="adm-sitefile">
          {kind === 'video' ? (
            // muted and controlled: a preview to check the cut, not to watch
            <video className="adm-sitefile__video" src={value.url} controls muted preload="metadata" playsInline />
          ) : (
            <a className="adm-sitefile__pdf" href={value.url} target="_blank" rel="noreferrer noopener">
              <span className="adm-sitefile__name">{value.alt || 'notebook.pdf'}</span>
              <span className="adm-muted adm-small">Open</span>
            </a>
          )}
        </div>
      ) : (
        <p className="adm-muted">Nothing uploaded.</p>
      )}

      <div className="adm-row adm-gap-top">
        <input
          ref={inputRef}
          id={inputId}
          className="adm-sr"
          type="file"
          accept={accept}
          disabled={busy}
          onChange={(e) => void upload(e.target.files?.[0])}
        />
        <Button size="sm" icon={busy ? undefined : <IconUpload size={14} />} disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? <Spinner label="Uploading" /> : value ? 'Replace' : `Upload ${what}`}
        </Button>
        {busy && <span className="adm-muted adm-small">Uploading — large files take a moment.</span>}
      </div>

      {hint && <p className="adm-field__hint">{hint}</p>}
      {refused && <p className="adm-field__error">{refused}</p>}
      {error && <p className="adm-field__error">{error}</p>}
      <ErrorBanner error={failed} title="The file was not uploaded" />
    </div>
  );
}
