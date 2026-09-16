import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../lib/util';

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  count?: number;
}

/** Filter tabs: roving focus, arrow keys, selection follows focus. */
export function Tabs<T extends string>({ items, value, onChange, label }: { items: TabItem<T>[]; value: T; onChange: (v: T) => void; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const item = items[next];
    if (!item) return;
    onChange(item.value);
    refs.current[next]?.focus();
  };
  return (
    <div className="adm-tabs" role="tablist" aria-label={label}>
      {items.map((item, i) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={cx('adm-tab', selected && 'adm-tab--on')}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {item.label}
            {item.count !== undefined && <span className="adm-tab__count">{item.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
