import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { useSheetNavigate } from '../lib/routes';

/** A real link (it opens in a new tab) that, clicked plainly, moves within the current sheet. */
export function SheetLink({
  to, replace = false, onClick, ...rest
}: { to: string; replace?: boolean } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const go = useSheetNavigate();
  const follow = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go(to, { replace });
  };
  return <a href={to} onClick={follow} {...rest} />;
}
