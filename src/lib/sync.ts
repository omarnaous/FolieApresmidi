/**
 * Tabs of the same browser telling each other the shop changed. A save in the
 * admin announces it; any shop tab open beside it hears that and fetches
 * afresh — so reordering collections in one tab reorders the shop in the
 * other at once, instead of whenever that tab next decides its copy is old.
 */
const CHANNEL = 'fdm-catalog';

/** When this tab last heard of a change — 0 until it has. */
let heard = 0;
/**
 * A version to put on the next store request after a change, so it goes past
 * the edge's cached copy to the Worker itself. Empty until a change is heard.
 */
export const catalogVersion = (): string => (heard ? `?v=${heard}` : '');

export function announceCatalogChange(): void {
  try {
    const c = new BroadcastChannel(CHANNEL);
    c.postMessage('changed');
    c.close();
  } catch {
    /* no BroadcastChannel: the other tab catches up when it is next focused */
  }
}

/** Calls `fn` whenever another tab announces a change. Returns the unsubscribe. */
export function onCatalogChange(fn: () => void): () => void {
  try {
    const c = new BroadcastChannel(CHANNEL);
    c.onmessage = () => {
      heard = Date.now();
      fn();
    };
    return () => c.close();
  } catch {
    return () => {};
  }
}
