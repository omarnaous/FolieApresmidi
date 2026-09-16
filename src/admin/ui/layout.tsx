import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useDocumentTitle } from '../lib/hooks';
import { cx } from '../lib/util';
import { Button } from './Button';
import { IconChevronLeft } from './icons';

export function PageHeader({
  title,
  docTitle,
  back,
  meta,
  actions,
}: {
  title: ReactNode;
  /** browser tab title when `title` is not plain text */
  docTitle?: string;
  back?: { to: string; label: string };
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  useDocumentTitle(docTitle ?? (typeof title === 'string' ? title : 'Admin'));
  return (
    <header className="adm-pagehead">
      <div className="adm-pagehead__main">
        {back && (
          <Link to={back.to} className="adm-back">
            <IconChevronLeft size={14} />
            {back.label}
          </Link>
        )}
        <h1 className="adm-pagehead__title">{title}</h1>
        {meta && <div className="adm-pagehead__meta">{meta}</div>}
      </div>
      {actions && <div className="adm-pagehead__actions">{actions}</div>}
    </header>
  );
}

export function Card({
  title,
  actions,
  children,
  className,
  flush,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** no body padding (tables) */
  flush?: boolean;
}) {
  return (
    <section className={cx('adm-card', flush && 'adm-card--flush', className)}>
      {(title || actions) && (
        <header className="adm-card__head">
          {title && <h2 className="adm-card__title">{title}</h2>}
          {actions && <div className="adm-card__actions">{actions}</div>}
        </header>
      )}
      <div className="adm-card__body">{children}</div>
    </section>
  );
}

export function LoadMore({ shown, total, hasMore, loading, onClick }: { shown: number; total: number; hasMore: boolean; loading: boolean; onClick: () => void }) {
  return (
    <div className="adm-loadmore">
      <span className="adm-muted">
        Showing {shown.toLocaleString()} of {total.toLocaleString()}
      </span>
      {hasMore && (
        <Button size="sm" onClick={onClick} loading={loading}>
          Load more
        </Button>
      )}
    </div>
  );
}

/** Sticky save bar for editors. */
export function SaveBar({ dirty, saving, onSave, onDiscard, saveLabel = 'Save' }: { dirty: boolean; saving: boolean; onSave: () => void; onDiscard?: () => void; saveLabel?: string }) {
  return (
    <div className={cx('adm-savebar', dirty && 'adm-savebar--dirty')}>
      <span className="adm-savebar__status" aria-live="polite">
        {saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'All changes saved'}
      </span>
      <div className="adm-savebar__actions">
        {onDiscard && dirty && (
          <Button onClick={onDiscard} disabled={saving}>
            Discard
          </Button>
        )}
        <Button variant="primary" onClick={onSave} loading={saving} disabled={!dirty}>
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}

export const DefinitionList = ({ items }: { items: [ReactNode, ReactNode][] }) => (
  <dl className="adm-dl">
    {items.map(([k, v], i) => (
      <div key={i} className="adm-dl__row">
        <dt>{k}</dt>
        <dd>{v}</dd>
      </div>
    ))}
  </dl>
);
