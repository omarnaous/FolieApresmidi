/**
 * The full-page sheet the checkout drew first — one scroller under the site
 * bar, with its own slim bar for Back and Close —
 * shared by the order confirmation, the account and the policy pages.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { useSwipeDismiss } from '../hooks/useSwipeDismiss';
import { useEscape, useSheetFocus } from '../hooks/useSheet';

interface SheetProps {
  open: boolean;
  label: string;
  onClose: () => void;
  /** the back link's words, e.g. "Keep shopping" */
  back?: string;
  children?: ReactNode;
}

export function Sheet({ open, label, onClose, back = 'Boutique', children }: SheetProps) {
  const sheet = useRef<HTMLDivElement>(null);

  useSwipeDismiss(sheet, onClose, { enabled: open });
  useEscape(open, onClose);
  useSheetFocus(sheet, open);

  useEffect(() => {
    if (open) sheet.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [open]);

  return (
    // data-lenis-prevent: a stopped Lenis preventDefaults every touchmove,
    // including the ones meant for this scroller.
    <div
      className={`co ${open ? 'on' : ''}`}
      role="dialog"
      aria-label={label}
      aria-hidden={!open}
      tabIndex={-1}
      ref={sheet}
      data-lenis-prevent
    >
      <header className="co-bar">
        <button className="co-back label" onClick={onClose}>
          <span aria-hidden="true">←</span> {back}
        </button>
        <button className="co-x label" onClick={onClose} aria-label="Close">Close</button>
      </header>
      {children}
    </div>
  );
}
