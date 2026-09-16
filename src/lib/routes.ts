/**
 * The URL decides which overlay is up. The home page always renders
 * underneath; every sheet, the catalogue and the bag hang off a path.
 *
 * Location state carries:
 *   catalogue  the catalogue URL a product was opened from, so the catalogue
 *              stays open underneath it
 *   depth      how many entries deep inside the same sheet we are, so Close
 *              steps back past all of them in one go
 *   notice     a one-off line for the screen the navigation lands on
 */
import { useCallback } from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router';

export type Route =
  | { kind: 'home' }
  | { kind: 'product'; handle: string }
  | { kind: 'catalogue' }
  | { kind: 'cart' }
  | { kind: 'checkout' }
  | { kind: 'order'; token: string }
  | { kind: 'account' }
  | { kind: 'page'; handle: string };

export function parseRoute(pathname: string): Route {
  const at = (path: string) => matchPath({ path, end: true }, pathname);
  const product = at('/products/:handle');
  if (product?.params.handle) return { kind: 'product', handle: product.params.handle };
  if (at('/collections/:handle') || at('/search')) return { kind: 'catalogue' };
  if (at('/cart')) return { kind: 'cart' };
  if (at('/checkout')) return { kind: 'checkout' };
  const order = at('/orders/:token');
  if (order?.params.token) return { kind: 'order', token: order.params.token };
  if (matchPath({ path: '/account/*' }, pathname)) return { kind: 'account' };
  const page = at('/pages/:handle');
  if (page?.params.handle) return { kind: 'page', handle: page.params.handle };
  return { kind: 'home' };
}

export interface SheetState {
  catalogue?: string;
  depth?: number;
  /** a line to show once where the navigation lands, e.g. after a password reset */
  notice?: string;
}

export const sheetState = (state: unknown): SheetState =>
  state && typeof state === 'object' ? (state as SheetState) : {};

/** BrowserRouter numbers its entries; 0 is where this visit to the site began. */
const historyIndex = () => (window.history.state as { idx?: number } | null)?.idx ?? 0;

/**
 * Close whatever is up: step back to the entry the sheet was opened from when
 * it is one of ours, otherwise land on the home page.
 */
export function useCloseOverlay() {
  const navigate = useNavigate();
  const depth = sheetState(useLocation().state).depth ?? 0;
  return useCallback(() => {
    if (historyIndex() > depth) navigate(-(depth + 1));
    else navigate('/', { replace: true });
  }, [navigate, depth]);
}

/** Move within the same sheet (a tab, a detail), one entry deeper, so Close still leaves the whole sheet. */
export function useSheetNavigate() {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(
    (to: string, { replace = false }: { replace?: boolean } = {}) => {
      const state = sheetState(location.state);
      const depth = state.depth ?? 0;
      navigate(to, { replace, state: { ...state, depth: replace ? depth : depth + 1 } });
    },
    [navigate, location.state],
  );
}

/** Only same-site paths are followed after a sign-in. */
export const safeNext = (next: string | null | undefined): string | null =>
  next && next.startsWith('/') && !next.startsWith('//') ? next : null;

/** `/collections/dresses?q=…` or `/search?q=…` → which collection, and the rest of the query. */
export function parseCatalogue(path: string): { base: string; handle: string; params: URLSearchParams } {
  const [pathname = '', search = ''] = path.split('?');
  const match = matchPath({ path: '/collections/:handle', end: true }, pathname);
  const handle = match?.params.handle ?? 'all';
  return { base: match ? pathname : '/search', handle, params: new URLSearchParams(search) };
}
