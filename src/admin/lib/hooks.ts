import { useCallback, useEffect, useRef, useState, type RefCallback } from 'react';

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = `${title} · FDM Admin`;
    return () => {
      document.title = prev;
    };
  }, [title]);
}

const LEAVE_MESSAGE = 'You have unsaved changes. Leave without saving?';

/**
 * Warn before losing edits: on reload/close (beforeunload) and on in-app
 * link clicks. The click guard runs in the capture phase on the document,
 * ahead of React Router's own handler, so a cancelled confirm stops the
 * navigation. (Programmatic navigate() calls are not intercepted — editors
 * only call it after a successful save or delete.)
 */
export function useUnsavedChanges(dirty: boolean) {
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current || e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (!(target instanceof HTMLAnchorElement)) return;
      if (target.target === '_blank' || target.hasAttribute('download')) return;
      const url = new URL(target.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (!window.confirm(LEAVE_MESSAGE)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, []);
}

export function useCopy(): [copied: boolean, copy: (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback((text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    });
  }, []);
  return [copied, copy];
}

/** Width of an element, tracked with ResizeObserver. */
export function useElementWidth<T extends HTMLElement>(): [RefCallback<T>, number] {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    if (!node) return;
    setWidth(node.getBoundingClientRect().width);
    observer.current = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.current.observe(node);
  }, []);
  return [ref, width];
}
