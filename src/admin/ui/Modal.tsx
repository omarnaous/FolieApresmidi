import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cx } from '../lib/util';
import { Button } from './Button';
import { ErrorBanner } from './feedback';
import { IconClose } from './icons';

interface DialogShellProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** false while a mutation is pending */
  dismissible?: boolean;
  className?: string;
  variant: 'modal' | 'drawer' | 'drawer-left';
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Native <dialog> opened with showModal(): the rest of the page becomes
 * inert (focus is trapped), Escape fires `cancel`, and focus returns to the
 * element that opened it.
 */
function DialogShell({ open, onClose, title, children, footer, dismissible = true, className, variant, size = 'md' }: DialogShellProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    const autofocus = dialog.querySelector<HTMLElement>('[data-autofocus]');
    autofocus?.focus();
    return () => {
      if (dialog.open) dialog.close();
      opener?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <dialog
      ref={ref}
      className={cx('adm-dialog', `adm-dialog--${variant}`, `adm-dialog--${size}`, className)}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) closeRef.current();
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissible) closeRef.current();
      }}
      onClose={(e) => {
        // The browser can force-close on a repeated Escape; keep React in charge.
        const dialog = e.currentTarget;
        if (!dialog.isConnected) return;
        if (dismissibleRef.current) closeRef.current();
        else dialog.showModal();
      }}
    >
      <div className="adm-dialog__panel">
        <header className="adm-dialog__head">
          <h2 id={titleId} className="adm-dialog__title">
            {title}
          </h2>
          <button type="button" className="adm-iconbtn" aria-label="Close" onClick={() => dismissible && onClose()} disabled={!dismissible}>
            <IconClose />
          </button>
        </header>
        <div className="adm-dialog__body">{children}</div>
        {footer && <footer className="adm-dialog__foot">{footer}</footer>}
      </div>
    </dialog>
  );
}

type PublicProps = Omit<DialogShellProps, 'variant'>;

export const Modal = (props: PublicProps) => <DialogShell {...props} variant="modal" />;
export const Drawer = ({ side = 'right', ...props }: PublicProps & { side?: 'left' | 'right' }) => (
  <DialogShell {...props} variant={side === 'left' ? 'drawer-left' : 'drawer'} />
);

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = 'Confirm',
  tone = 'primary',
  pending,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  tone?: 'primary' | 'danger';
  pending?: boolean;
  error?: unknown;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      dismissible={!pending}
      footer={
        <>
          <Button onClick={onClose} disabled={pending} data-autofocus>
            Cancel
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={pending}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {error ? <ErrorBanner error={error} /> : null}
      {typeof body === 'string' ? <p>{body}</p> : body}
    </Modal>
  );
}
