import { useInfiniteQuery } from '@tanstack/react-query';
import { useId, useRef, useState, type DragEvent } from 'react';
import { api, get, imageSrc, type MediaDTO, type Page } from '../lib/contract';
import { qk } from '../lib/queries';
import { cx } from '../lib/util';
import { Button, Spinner } from './Button';
import { EmptyState, ErrorBanner } from './feedback';
import { IconUpload } from './icons';
import { Modal } from './Modal';

const MAX_BYTES = 10 * 1024 * 1024;
const BATCH = 20;
/** Wide enough for the product page on a large screen at 2× pixel density. */
const MAX_EDGE = 2000;

/**
 * Shrink a photograph before it is sent.
 *
 * A picture taken on a phone is four thousand pixels wide and several
 * megabytes; a shopper looking at it needs neither. Where the shop has the
 * paid image pipeline it would resize on the way out, but a shop without one
 * serves exactly what was uploaded — so the browser does the work here, once,
 * instead of every visitor paying for it on every view.
 *
 * Anything that will not decode — an unusual format, a browser without WebP —
 * is handed back untouched and the server decides what to do with it.
 */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    // already small enough, and not heavy: leave it exactly as it is
    if (scale === 1 && file.size <= 600 * 1024) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.86));
    if (!blob || blob.size >= file.size) return file;
    const name = `${file.name.replace(/\.[a-z0-9]+$/i, '')}.webp`;
    return new File([blob], name, { type: 'image/webp' });
  } catch {
    return file;
  }
}

/** Drag & drop or pick images → POST /api/admin/media (field "files"). */
export function ImageUploader({
  onUploaded,
  multiple = true,
  label = 'Add images',
  compact,
}: {
  onUploaded: (items: MediaDTO[]) => void;
  multiple?: boolean;
  label?: string;
  compact?: boolean;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [rejected, setRejected] = useState<string[]>([]);

  const upload = async (list: FileList | File[]) => {
    const files = Array.from(list);
    const bad: string[] = [];
    const ok = files.filter((f) => {
      if (!f.type.startsWith('image/')) bad.push(`${f.name}: not an image`);
      else if (f.size > MAX_BYTES) bad.push(`${f.name}: larger than 10 MB`);
      else return true;
      return false;
    });
    const chosen = multiple ? ok : ok.slice(0, 1);
    setRejected(bad);
    setError(null);
    if (!chosen.length) return;
    setBusy(true);
    try {
      const ready = await Promise.all(chosen.map(shrink));
      const uploaded: MediaDTO[] = [];
      for (let i = 0; i < ready.length; i += BATCH) {
        const fd = new FormData();
        ready.slice(i, i + BATCH).forEach((f) => fd.append('files', f));
        const res = await api<{ items: MediaDTO[] }>('/api/admin/media', { method: 'POST', body: fd });
        uploaded.push(...res.items);
      }
      onUploaded(uploaded);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (!busy && e.dataTransfer.files.length) void upload(e.dataTransfer.files);
  };

  return (
    <div>
      <div
        className={cx('adm-drop', over && 'adm-drop--over', compact && 'adm-drop--compact')}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        {busy ? <Spinner label="Uploading" /> : <IconUpload size={20} />}
        <div className="adm-drop__text">
          <label htmlFor={inputId} className="adm-drop__label">
            {busy ? 'Uploading…' : label}
          </label>
          {!compact && <span className="adm-muted">Drop {multiple ? 'images' : 'an image'} here · JPG, PNG, WebP, AVIF up to 10 MB</span>}
        </div>
        <Button size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
          Choose {multiple ? 'files' : 'file'}
        </Button>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept="image/*"
          multiple={multiple}
          className="adm-sr"
          tabIndex={-1}
          onChange={(e) => e.target.files && void upload(e.target.files)}
        />
      </div>
      {rejected.length > 0 && (
        <ul className="adm-field__error adm-list-plain">
          {rejected.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <ErrorBanner error={error} />
    </div>
  );
}

/** Pick an existing image from the media library (or upload a new one). */
export function MediaLibraryModal({ open, onClose, onSelect }: { open: boolean; onClose: () => void; onSelect: (m: MediaDTO) => void }) {
  const q = useInfiniteQuery({
    queryKey: qk.media,
    queryFn: ({ pageParam, signal }) => get<Page<MediaDTO>>('/api/admin/media', { cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: open,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const pick = (m: MediaDTO) => {
    onSelect(m);
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Choose an image" size="lg">
      <ImageUploader multiple={false} label="Upload a new image" compact onUploaded={(items) => items[0] && pick(items[0])} />
      <div className="adm-gap" />
      {q.error ? <ErrorBanner error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.isPending ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState compact title="No images yet" body="Upload one above." />
      ) : (
        <ul className="adm-libgrid">
          {items.map((m) => (
            <li key={m.id}>
              <button type="button" className="adm-libgrid__item" onClick={() => pick(m)} aria-label={`Use ${m.alt || 'image'}`}>
                <img
              decoding="async" src={imageSrc(m, 320)} alt="" loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.hasNextPage && (
        <div className="adm-loadmore">
          <Button size="sm" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>
            Load more
          </Button>
        </div>
      )}
    </Modal>
  );
}

/**
 * Single image slot: preview + choose/replace/remove. `fallback` is what the
 * storefront shows while the slot is empty; it previews dimmed, with `fallbackHint`.
 */
export function SingleImageField({
  label,
  value,
  onChange,
  fallback,
  fallbackHint,
}: {
  label: string;
  value: MediaDTO | null;
  onChange: (m: MediaDTO | null) => void;
  fallback?: MediaDTO | null;
  fallbackHint?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="adm-field">
      <span className="adm-field__label">{label}</span>
      <div className="adm-singleimg">
        {value ? (
          <img
              decoding="async" src={imageSrc(value, 320)} alt={value.alt} />
        ) : fallback ? (
          <img
              decoding="async" className="adm-singleimg__fallback" src={imageSrc(fallback, 320)} alt="" />
        ) : (
          <span className="adm-thumb adm-thumb--empty adm-singleimg__empty" aria-hidden="true" />
        )}
        <div className="adm-row">
          <Button size="sm" onClick={() => setOpen(true)}>
            {value ? 'Replace' : 'Choose image'}
          </Button>
          {value && (
            <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
              Remove
            </Button>
          )}
        </div>
      </div>
      {!value && fallbackHint && <p className="adm-field__hint">{fallbackHint}</p>}
      <MediaLibraryModal open={open} onClose={() => setOpen(false)} onSelect={onChange} />
    </div>
  );
}
