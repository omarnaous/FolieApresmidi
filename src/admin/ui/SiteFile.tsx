import { useId, useRef, useState } from 'react';
import { uploadFile, type MediaDTO, type SiteFileDTO } from '../lib/contract';
import { inspectFilm, playsHere, type FilmInfo } from '../lib/mp4';
import { Button, Spinner } from './Button';
import { ErrorBanner } from './feedback';
import { IconTrash, IconUpload } from './icons';

/** Cloudflare takes up to 100 MB in one request; the store stops just under it. */
const MAX_BYTES = 95 * 1024 * 1024;
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** What a film is, in a line: "H.264 · 1920×1080 · 0:24". */
const describe = (f: FilmInfo) =>
  [f.codecName, f.width && f.height ? `${f.width}×${f.height}` : null, f.seconds ? clock(f.seconds) : null].filter(Boolean).join(' · ');

/**
 * The two files the site itself uses: the opening film and the notebook.
 * One file, streamed to R2 through POST /api/admin/site-files with its
 * progress shown, and shown back as what it is — the film plays, the
 * notebook opens. A film is read first, so the admin can say who can watch
 * it, and so the shop can tell a browser that cannot play it to show the
 * house film instead.
 */
export function SiteFileField({
  label,
  hint,
  kind,
  value,
  onChange,
  type,
  error,
}: {
  label: string;
  hint?: string;
  kind: 'video' | 'pdf';
  /** the saved file, as the home page carries it */
  value: MediaDTO | null;
  /** `type` is the film's MIME type with its codec, when it is a film */
  onChange: (file: MediaDTO | null, type?: string | null) => void;
  /** the saved film's type, to say what it is */
  type?: string | null;
  error?: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<unknown>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [film, setFilm] = useState<FilmInfo | null>(null);
  const cancel = useRef<AbortController | null>(null);

  // MP4, M4V and MOV are one container; an H.264 .mov plays as an MP4 does
  const accept = kind === 'video' ? 'video/mp4,video/quicktime,video/x-m4v,.mp4,.m4v,.mov' : 'application/pdf,.pdf';
  const what = kind === 'video' ? 'an MP4 video' : 'a PDF';

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setFailed(null);
    setRefused(null);
    const looksRight =
      kind === 'video'
        ? /\.(mp4|m4v|mov)$/i.test(file.name) || /^video\/(mp4|quicktime|x-m4v)$/i.test(file.type)
        : /\.pdf$|^application\/pdf$/i.test(`${file.name}${file.type}`);
    if (!looksRight) return setRefused(`${file.name} is not ${kind === 'video' ? 'an MP4, MOV or M4V video' : what}.`);
    if (file.size > MAX_BYTES) {
      return setRefused(`${file.name} is ${mb(file.size)} — the limit is ${mb(MAX_BYTES)}. Export it smaller (1080p H.264 is plenty for the opening) and try again.`);
    }

    const info = kind === 'video' ? await inspectFilm(file) : null;
    setBusy(true);
    setProgress(0);
    cancel.current = new AbortController();
    try {
      const uploaded = await uploadFile<SiteFileDTO>('/api/admin/site-files', file, {
        onProgress: (sent, total) => setProgress(total ? sent / total : 0),
        signal: cancel.current.signal,
      });
      setFilm(info);
      onChange({ id: uploaded.id, url: uploaded.url, alt: uploaded.name, width: info?.width ?? null, height: info?.height ?? null }, info?.type ?? null);
    } catch (e) {
      setFailed(e);
    } finally {
      setBusy(false);
      setProgress(null);
      cancel.current = null;
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  // what the saved film is: read now, or from the type it was saved with
  const savedType = film?.type ?? type ?? null;
  const hevc = !!savedType && /codecs="(hvc1|hev1)/.test(savedType);
  const odd = !!savedType && !hevc && !/codecs="avc[13]/.test(savedType);

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
            <>
              <video className="adm-sitefile__video" src={value.url} controls muted preload="metadata" playsInline />
              {film && <p className="adm-muted adm-small">{describe(film)}</p>}
              {hevc && (
                <p className="adm-field__hint adm-sitefile__warn">
                  This film is HEVC (H.265), as an iPhone records it. Safari and iPhones play it; Chrome on many Android
                  phones and Windows computers cannot, and there the house film plays instead. For everyone to see it,
                  export it as H.264 (in QuickTime: File → Export As → 1080p, “Greater compatibility”).
                  {!playsHere(savedType!) && ' This browser cannot play it either.'}
                </p>
              )}
              {odd && (
                <p className="adm-field__hint adm-sitefile__warn">
                  This film is not H.264, so some browsers may not play it — those show the house film instead. Export it
                  as H.264 for everyone to see it.
                </p>
              )}
            </>
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
        {busy && (
          <>
            <span className="adm-muted adm-small" role="status">
              Uploading{progress !== null ? ` — ${Math.round(progress * 100)}%` : ''}. Keep this page open.
            </span>
            <Button size="sm" variant="link" onClick={() => cancel.current?.abort()}>
              Cancel
            </Button>
          </>
        )}
      </div>

      {busy && progress !== null && (
        <span className="adm-sitefile__bar" aria-hidden="true">
          <i style={{ width: `${Math.round(progress * 100)}%` }} />
        </span>
      )}

      {hint && <p className="adm-field__hint">{hint}</p>}
      {refused && <p className="adm-field__error">{refused}</p>}
      {error && <p className="adm-field__error">{error}</p>}
      <ErrorBanner error={failed} title="The file was not uploaded" />
    </div>
  );
}
