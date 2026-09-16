import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { cx } from '../lib/util';
import { IconClose } from './icons';

interface Toast {
  id: number;
  tone: 'success' | 'error';
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (tone: Toast['tone'], message: string) => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-3), { id, tone, message }]);
      setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 4000);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(() => ({ success: (m) => push('success', m), error: (m) => push('error', m) }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="adm-toasts adm-noprint" aria-live="polite" aria-relevant="additions">
        {toasts.map((t) => (
          <div key={t.id} className={cx('adm-toast', `adm-toast--${t.tone}`)} role={t.tone === 'error' ? 'alert' : 'status'}>
            <span>{t.message}</span>
            <button type="button" className="adm-iconbtn adm-iconbtn--light" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <IconClose size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast outside ToastProvider');
  return ctx;
}
