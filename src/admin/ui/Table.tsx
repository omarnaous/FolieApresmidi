import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { cx } from '../lib/util';
import { IconArrowDown, IconArrowUp } from './icons';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** enables a sortable header (sorts the rows currently loaded) */
  sort?: (a: T, b: T) => number;
  align?: 'left' | 'right' | 'center';
  width?: string;
  /** header is visually hidden (still read by screen readers) */
  hideHeader?: boolean;
}

interface Selection {
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  rowLabel: (id: string) => string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  /** clicking anywhere on a row (outside controls) goes here */
  rowHref?: (row: T) => string;
  selection?: Selection;
  footer?: ReactNode;
  className?: string;
}

const INTERACTIVE = 'a, button, input, select, textarea, label, [role="switch"]';

export function DataTable<T>({ columns, rows, rowKey, caption, rowHref, selection, footer, className }: DataTableProps<T>) {
  const navigate = useNavigate();
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);

  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.key === sort.key);
    if (!col?.sort || !sort) return rows;
    const cmp = col.sort;
    return [...rows].sort((a, b) => cmp(a, b) * sort.dir);
  }, [rows, columns, sort]);

  const ids = sorted.map(rowKey);
  const selectedCount = selection ? ids.filter((id) => selection.selected.has(id)).length : 0;
  const allSelected = selection && ids.length > 0 && selectedCount === ids.length;

  const onRowClick = (e: MouseEvent<HTMLTableRowElement>, row: T) => {
    if (!rowHref) return;
    if (e.target instanceof Element && e.target.closest(INTERACTIVE)) return;
    if (window.getSelection()?.toString()) return;
    navigate(rowHref(row));
  };

  return (
    <>
    <div className={cx('adm-table-wrap', className)} role="region" aria-label={caption} tabIndex={0}>
      <table className="adm-table">
        <caption className="adm-sr">{caption}</caption>
        <thead>
          <tr>
            {selection && (
              <th scope="col" className="adm-table__check">
                <input
                  type="checkbox"
                  aria-label="Select all rows"
                  checked={!!allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = selectedCount > 0 && !allSelected;
                  }}
                  onChange={(e) => {
                    const next = new Set(selection.selected);
                    ids.forEach((id) => (e.target.checked ? next.add(id) : next.delete(id)));
                    selection.onChange(next);
                  }}
                />
              </th>
            )}
            {columns.map((col) => {
              const active = sort?.key === col.key;
              return (
                <th
                  key={col.key}
                  scope="col"
                  style={{ width: col.width, textAlign: col.align }}
                  aria-sort={active ? (sort?.dir === 1 ? 'ascending' : 'descending') : col.sort ? 'none' : undefined}
                >
                  {col.sort ? (
                    <button
                      type="button"
                      className={cx('adm-table__sort', active && 'adm-table__sort--on')}
                      onClick={() => setSort(active && sort?.dir === 1 ? { key: col.key, dir: -1 } : active ? null : { key: col.key, dir: 1 })}
                    >
                      {col.header}
                      {active ? sort?.dir === 1 ? <IconArrowUp size={12} /> : <IconArrowDown size={12} /> : <span className="adm-table__sorthint" aria-hidden="true" />}
                    </button>
                  ) : (
                    <span className={cx(col.hideHeader && 'adm-sr')}>{col.header}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const id = rowKey(row);
            const checked = selection?.selected.has(id) ?? false;
            return (
              <tr key={id} className={cx(rowHref && 'adm-table__row--link', checked && 'adm-table__row--on')} onClick={(e) => onRowClick(e, row)}>
                {selection && (
                  <td className="adm-table__check">
                    <input
                      type="checkbox"
                      aria-label={`Select ${selection.rowLabel(id)}`}
                      checked={checked}
                      onChange={(e) => {
                        const next = new Set(selection.selected);
                        if (e.target.checked) next.add(id);
                        else next.delete(id);
                        selection.onChange(next);
                      }}
                    />
                  </td>
                )}
                {columns.map((col) => (
                  <td key={col.key} style={{ textAlign: col.align }}>
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    {footer}
    </>
  );
}

export const Thumb = ({ src, alt = '', size = 40 }: { src: string | null | undefined; alt?: string; size?: number }) =>
  src ? (
    <img
              decoding="async" className="adm-thumb" src={src} alt={alt} width={size} height={size} loading="lazy" style={{ width: size, height: size }} />
  ) : (
    <span className="adm-thumb adm-thumb--empty" style={{ width: size, height: size }} aria-hidden="true" />
  );
