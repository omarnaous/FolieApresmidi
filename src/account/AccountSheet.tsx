/**
 * /account/* — one sheet. Signed out it is the sign-in screens; signed in it
 * is a greeting, four tabs and the one that is open. Moving between tabs goes
 * one entry deeper, so Close always leaves the whole sheet.
 */
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { messageFor } from '../lib/errors';
import { firstName } from '../lib/format';
import { useLogout, useSession } from '../lib/queries';
import { safeNext, sheetState, useSheetNavigate } from '../lib/routes';
import { useLinger } from '../hooks/useSheet';
import { Sheet } from '../ui/Sheet';
import { SheetLink } from '../ui/SheetLink';
import { LoadError, Loading } from '../ui/States';
import { Forgot, Login, Register, Reset, Verify } from './AuthScreens';
import { Addresses } from './Addresses';
import { Details } from './Details';
import { OrderDetail, Orders } from './Orders';
import { Wishlist } from './Wishlist';

const TABS = [
  { to: '/account/orders', label: 'Orders', on: (s: string) => s === '' || s === 'orders' || s.startsWith('orders/') },
  { to: '/account/addresses', label: 'Addresses', on: (s: string) => s === 'addresses' },
  { to: '/account/wishlist', label: 'Wishlist', on: (s: string) => s === 'wishlist' },
  { to: '/account/details', label: 'Details', on: (s: string) => s === 'details' },
];

export default function AccountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const location = useLocation();
  // hold the last account URL while the sheet slides away
  const here = useLinger(open ? location.pathname + location.search : null);

  return (
    <Sheet open={open} label="Account" onClose={onClose}>
      {here && <AccountBody here={here} />}
    </Sheet>
  );
}

function AccountBody({ here }: { here: string }) {
  const [pathname = '', search = ''] = here.split('?');
  const params = new URLSearchParams(search);
  const sub = pathname.replace(/^\/account\/?/, '').replace(/\/+$/, '');
  const next = safeNext(params.get('next'));

  const session = useSession();
  const customer = session.data?.customer ?? null;
  const navigate = useNavigate();
  const location = useLocation();
  const go = useSheetNavigate();
  const logout = useLogout();
  const notice = sheetState(location.state).notice;

  // signed in on a sign-in screen: on to wherever they were headed
  const arrived = !!customer && (sub === 'login' || sub === 'register' || sub === 'forgot');
  // fires once, on arrival — not again as the location it navigates to comes in
  useEffect(() => {
    if (arrived) navigate(next ?? '/account', { replace: true, state: sheetState(location.state) });
  }, [arrived]);

  if (sub === 'verify') return <Verify token={params.get('token')} />;
  if (sub === 'reset') return <Reset token={params.get('token')} />;

  if (session.isPending || arrived) return <div className="acct"><Loading label="One moment…" /></div>;

  if (session.isError && !session.data) {
    return (
      <div className="acct">
        <LoadError title="Your account did not load." message={messageFor(session.error)} onRetry={() => session.refetch()} />
      </div>
    );
  }

  if (!customer) {
    if (sub === 'register') return <Register next={next} email={params.get('email')} />;
    if (sub === 'forgot') return <Forgot />;
    // any other account page asks for a sign-in first, then shows itself
    return <Login next={next} />;
  }

  const orderNumber = /^orders\/(.+)$/.exec(sub)?.[1];
  const first = firstName(customer.name);

  return (
    <div className="acct">
      <div className="co-head acct-head">
        <div className="label muted">Account</div>
        <h1 className="display d-md">Bonjour{first ? `, ${first}` : ''}.</h1>
        {notice && <p className="label acct-notice" role="status">{notice}</p>}
      </div>

      <div className="acct-nav">
        <nav className="filters left acct-tabs" aria-label="Account">
          {TABS.map((t) => {
            const on = t.on(sub);
            return (
              <SheetLink
                key={t.to}
                to={t.to}
                replace={on}
                className={`chip ${on ? 'on' : ''}`}
                aria-current={on ? 'page' : undefined}
              >
                {t.label}
              </SheetLink>
            );
          })}
        </nav>
        <button
          className="label link-u"
          onClick={() => logout.mutate(undefined, { onSuccess: () => go('/account/login', { replace: true }) })}
          disabled={logout.isPending}
        >
          {logout.isPending ? 'Logging out…' : 'Log out'}
        </button>
      </div>
      {logout.isError && <p className="co-err label" role="alert">{messageFor(logout.error)}</p>}

      {orderNumber ? (
        <OrderDetail number={decodeURIComponent(orderNumber)} />
      ) : sub === 'addresses' ? (
        <Addresses />
      ) : sub === 'wishlist' ? (
        <Wishlist />
      ) : sub === 'details' ? (
        <Details customer={customer} />
      ) : (
        <Orders />
      )}
    </div>
  );
}
