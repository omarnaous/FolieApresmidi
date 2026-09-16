/** /pages/:handle — policies and the house's own pages, set as a readable column. */
import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router';
import { isNotFound, messageFor } from '../lib/errors';
import { formatDate } from '../lib/format';
import { usePage } from '../lib/queries';
import { useLinger } from '../hooks/useSheet';
import { Sheet } from '../ui/Sheet';

export default function PageSheet({ handle, onClose }: { handle: string | null; onClose: () => void }) {
  const held = useLinger(handle);
  const page = usePage(held);
  const navigate = useNavigate();
  const p = page.data;

  /* Links inside the body are plain HTML; the ones that stay on the site
     should move the app, not reload it. */
  const follow = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest?.('a');
    const href = a?.getAttribute('href');
    if (!a || !href || !href.startsWith('/') || href.startsWith('//') || a.target === '_blank') return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    navigate(href);
  };

  return (
    <Sheet open={!!handle} label={p?.title ?? 'Page'} onClose={onClose}>
      {held && (p ? (
        <article className="page-body">
          <div className="label muted">{p.kind === 'policy' ? 'Client care' : "Follies d'Après-Midi"}</div>
          <h1 className="display d-md">{p.title}</h1>
          {/* sanitized by the Worker before it is stored */}
          <div className="page-prose" onClick={follow} dangerouslySetInnerHTML={{ __html: p.bodyHtml }} />
          <span className="label muted">Updated {formatDate(p.updatedAt)}</span>
        </article>
      ) : page.isError ? (
        <div className="co-done" role="alert">
          <h1 className="display d-md">{isNotFound(page.error) ? 'There is no page here.' : 'This page did not load.'}</h1>
          <p className="lede">{isNotFound(page.error) ? 'The link may be out of date.' : messageFor(page.error)}</p>
          {!isNotFound(page.error) && <button className="btn solid" onClick={() => page.refetch()}>Try again</button>}
          <button className="btn" onClick={onClose}>Back to the boutique</button>
        </div>
      ) : (
        <div className="co-done" aria-busy="true">
          <span className="label muted" role="status">Opening the page…</span>
        </div>
      ))}
    </Sheet>
  );
}
