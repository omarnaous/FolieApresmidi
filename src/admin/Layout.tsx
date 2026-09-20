import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { post, type AdminSessionDTO, type Permission } from './lib/contract';
import { qk } from './lib/queries';
import { useCan, useStaff } from './lib/session';
import { Button, IconButton } from './ui/Button';
import { IconExternal, IconMenu } from './ui/icons';
import { Drawer } from './ui/Modal';
import { useToast } from './ui/Toasts';

export const NAV: { to: string; label: string; perm: Permission }[] = [
  { to: '/admin', label: 'Dashboard', perm: 'dashboard:read' },
  // the whole site — how it looks, what it says, and what the shop is called
  { to: '/admin/website', label: 'Website design', perm: 'settings:write' },
  { to: '/admin/collections', label: 'Collections', perm: 'products:read' },
  { to: '/admin/products', label: 'Products', perm: 'products:read' },
  { to: '/admin/inventory', label: 'Inventory', perm: 'products:read' },
  { to: '/admin/discounts', label: 'Discounts', perm: 'discounts:read' },
  { to: '/admin/orders', label: 'Orders', perm: 'orders:read' },
  { to: '/admin/customers', label: 'Customers', perm: 'customers:read' },
  { to: '/admin/shipping', label: 'Shipping', perm: 'shipping:write' },
  { to: '/admin/pages', label: 'Pages', perm: 'pages:write' },
  { to: '/admin/newsletter', label: 'Newsletter', perm: 'settings:write' },
  { to: '/admin/staff', label: 'Staff', perm: 'staff:manage' },
];

const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', staff: 'Staff' } as const;

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const can = useCan();
  const items = NAV.filter((item) => can(item.perm));
  return (
    <nav aria-label="Admin">
      <ol className="adm-nav">
        {items.map((item, i) => (
          <li key={item.to}>
            <NavLink to={item.to} end={item.to === '/admin'} className={({ isActive }) => (isActive ? 'adm-nav__link adm-nav__link--on' : 'adm-nav__link')} onClick={onNavigate}>
              <span className="adm-nav__num" aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
              {item.label}
            </NavLink>
          </li>
        ))}
      </ol>
    </nav>
  );
}

const Brand = () => (
  <span className="adm-brand">
    <span className="adm-wordmark">FDM</span>
    <span className="adm-label">Admin</span>
  </span>
);

export function AdminLayout() {
  const staff = useStaff();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  const section =
    [...NAV].sort((a, b) => b.to.length - a.to.length).find((item) => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`))?.label ??
    'Admin';

  const logout = useMutation({
    mutationFn: () => post<void>('/api/admin/auth/logout'),
    onSuccess: () => {
      qc.setQueryData<AdminSessionDTO>(qk.session, (s) => (s ? { ...s, staff: null } : s));
      qc.removeQueries({ queryKey: qk.root, predicate: (q) => q.queryKey[1] !== 'session' });
      navigate('/admin/login', { replace: true });
    },
    onError: () => toast.error('Could not log out. Try again.'),
  });

  return (
    <div className="adm-shell">
      <a href="#adm-main" className="adm-skip">
        Skip to content
      </a>
      <aside className="adm-sidebar adm-noprint">
        <Brand />
        <NavList />
      </aside>

      <div className="adm-frame">
        <header className="adm-topbar adm-noprint">
          <IconButton label="Open menu" className="adm-topbar__menu" onClick={() => setMenuOpen(true)} aria-expanded={menuOpen}>
            <IconMenu size={20} />
          </IconButton>
          <p className="adm-topbar__title">{section}</p>
          <div className="adm-topbar__right">
            <a href="/" target="_blank" rel="noopener" className="adm-topbar__link">
              View store <IconExternal size={13} />
            </a>
            <div className="adm-topbar__who">
              <span className="adm-topbar__name">{staff.name}</span>
              <span className="adm-label adm-muted">{ROLE_LABEL[staff.role]}</span>
            </div>
            <Button size="sm" variant="ghost" onClick={() => logout.mutate()} loading={logout.isPending}>
              Log out
            </Button>
          </div>
        </header>

        <main id="adm-main" className="adm-main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>

      <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} title={<Brand />} side="left" size="sm">
        <NavList onNavigate={() => setMenuOpen(false)} />
      </Drawer>
    </div>
  );
}
