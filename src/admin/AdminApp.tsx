/**
 * FDM Admin — mounted at /admin/* by src/main.jsx inside BrowserRouter and
 * QueryClientProvider (so no router or query client is created here).
 * Every admin style is scoped under `.adm`.
 */
import './admin.css';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { ApiError, type AdminSessionDTO, type Permission } from './lib/contract';
import { qk, useSession } from './lib/queries';
import { StaffProvider, useCan } from './lib/session';
import { AdminLayout, NAV } from './Layout';
import { AcceptInvitePage, AuthShell, ForgotPasswordPage, LoginPage, ResetPasswordPage, SetupPage } from './pages/Auth';
import AuditPage from './pages/Audit';
import CollectionEditor from './pages/collections/CollectionEditor';
import CollectionsList from './pages/collections/CollectionsList';
import CustomerDetail from './pages/customers/CustomerDetail';
import CustomersList from './pages/customers/CustomersList';
import Dashboard from './pages/Dashboard';
import DiscountEditor from './pages/discounts/DiscountEditor';
import DiscountsList from './pages/discounts/DiscountsList';
import OrderDetail from './pages/orders/OrderDetail';
import OrdersList from './pages/orders/OrdersList';
import PageEditor from './pages/content/PageEditor';
import PagesList from './pages/content/PagesList';
import ProductEditor from './pages/products/ProductEditor';
import ProductsList from './pages/products/ProductsList';
import SettingsPage from './pages/Settings';
import ShippingPage from './pages/Shipping';
import StaffPage from './pages/Staff';
import TaxesPage from './pages/Taxes';
import { ButtonLink, Spinner } from './ui/Button';
import { EmptyState, ErrorBanner, Forbidden } from './ui/feedback';
import { ToastProvider } from './ui/Toasts';

export default function AdminApp() {
  const qc = useQueryClient();

  // Admin-wide query defaults (the client itself belongs to the app shell).
  useState(() => {
    qc.setQueryDefaults(qk.root, {
      staleTime: 30_000,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    });
    return null;
  });

  // Any 401 while signed in → the session expired or was revoked: re-check it,
  // which swaps the app for the login screen.
  useEffect(() => {
    const onError = (err: unknown) => {
      if (!(err instanceof ApiError) || err.status !== 401) return;
      if (!qc.getQueryData<AdminSessionDTO>(qk.session)?.staff) return;
      void qc.invalidateQueries({ queryKey: qk.session });
    };
    const offQueries = qc.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error' && event.query.queryKey[1] !== 'session') onError(event.action.error);
    });
    const offMutations = qc.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') onError(event.action.error);
    });
    return () => {
      offQueries();
      offMutations();
    };
  }, [qc]);

  return (
    <div className="adm">
      <ToastProvider>
        <Gate />
      </ToastProvider>
    </div>
  );
}

function Gate() {
  const session = useSession();

  if (session.isPending) {
    return (
      <div className="adm-fullscreen">
        <span className="adm-wordmark">FDM</span>
        <Spinner label="Loading admin" />
      </div>
    );
  }
  if (session.error) {
    return (
      <AuthShell title="Admin unavailable">
        <ErrorBanner error={session.error} onRetry={() => void session.refetch()} />
      </AuthShell>
    );
  }

  const { staff, setupRequired } = session.data;
  if (setupRequired) return <SetupPage />;

  if (!staff) {
    return (
      <Routes>
        <Route path="login" element={<LoginPage />} />
        <Route path="forgot" element={<ForgotPasswordPage />} />
        <Route path="reset" element={<ResetPasswordPage />} />
        <Route path="invite" element={<AcceptInvitePage />} />
        <Route path="*" element={<RedirectToLogin />} />
      </Routes>
    );
  }

  return (
    <StaffProvider staff={staff}>
      <Routes>
        <Route path="login" element={<AfterLogin />} />
        <Route path="forgot" element={<Navigate to="/admin" replace />} />
        <Route path="reset" element={<ResetPasswordPage />} />
        <Route path="invite" element={<AcceptInvitePage />} />
        <Route element={<AdminLayout />}>
          <Route index element={<Home />} />
          <Route path="orders" element={<Guard perm="orders:read"><OrdersList /></Guard>} />
          <Route path="orders/:id" element={<Guard perm="orders:read"><OrderDetail /></Guard>} />
          <Route path="products" element={<Guard perm="products:read"><ProductsList /></Guard>} />
          <Route path="products/new" element={<Guard perm="products:write"><ProductEditor /></Guard>} />
          <Route path="products/:id" element={<Guard perm="products:read"><ProductEditor /></Guard>} />
          <Route path="collections" element={<Guard perm="products:read"><CollectionsList /></Guard>} />
          <Route path="collections/new" element={<Guard perm="products:write"><CollectionEditor /></Guard>} />
          <Route path="collections/:id" element={<Guard perm="products:read"><CollectionEditor /></Guard>} />
          <Route path="customers" element={<Guard perm="customers:read"><CustomersList /></Guard>} />
          <Route path="customers/:id" element={<Guard perm="customers:read"><CustomerDetail /></Guard>} />
          <Route path="discounts" element={<Guard perm="discounts:read"><DiscountsList /></Guard>} />
          <Route path="discounts/new" element={<Guard perm="discounts:write"><DiscountEditor /></Guard>} />
          <Route path="discounts/:id" element={<Guard perm="discounts:read"><DiscountEditor /></Guard>} />
          <Route path="shipping" element={<Guard perm="shipping:write"><ShippingPage /></Guard>} />
          <Route path="taxes" element={<Guard perm="taxes:write"><TaxesPage /></Guard>} />
          <Route path="pages" element={<Guard perm="pages:write"><PagesList /></Guard>} />
          <Route path="pages/new" element={<Guard perm="pages:write"><PageEditor /></Guard>} />
          <Route path="pages/:id" element={<Guard perm="pages:write"><PageEditor /></Guard>} />
          <Route path="settings" element={<Guard perm="settings:write"><SettingsPage /></Guard>} />
          <Route path="staff" element={<Guard perm="staff:manage"><StaffPage /></Guard>} />
          <Route path="audit" element={<Guard perm="staff:manage"><AuditPage /></Guard>} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </StaffProvider>
  );
}

function RedirectToLogin() {
  const location = useLocation();
  const from = `${location.pathname}${location.search}`;
  return <Navigate to="/admin/login" replace state={{ from }} />;
}

function AfterLogin() {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  return <Navigate to={from && from.startsWith('/admin') && !from.startsWith('/admin/login') ? from : '/admin'} replace />;
}

function Guard({ perm, children }: { perm: Permission; children: ReactNode }) {
  const can = useCan();
  return can(perm) ? <>{children}</> : <Forbidden />;
}

function Home() {
  const can = useCan();
  if (can('dashboard:read')) return <Dashboard />;
  const first = NAV.find((item) => item.perm !== 'dashboard:read' && can(item.perm));
  if (first) return <Navigate to={first.to} replace />;
  return <EmptyState title="Nothing to show yet" body="Your account has no permissions. Ask the store owner to grant you access." />;
}

function NotFound() {
  return <EmptyState title="Page not found" body="This admin page does not exist." action={<ButtonLink to="/admin">Back to the dashboard</ButtonLink>} />;
}
