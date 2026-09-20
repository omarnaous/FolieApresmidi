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
import CollectionEditor from './pages/collections/CollectionEditor';
import CollectionsList from './pages/collections/CollectionsList';
import CustomerDetail from './pages/customers/CustomerDetail';
import CustomersList from './pages/customers/CustomersList';
import Dashboard from './pages/Dashboard';
import WebsiteHome from './pages/website/Home';
import WebsiteStore from './pages/website/Store';
import DiscountEditor from './pages/discounts/DiscountEditor';
import DiscountsList from './pages/discounts/DiscountsList';
import InventoryPage from './pages/Inventory';
import NewsletterPage from './pages/Newsletter';
import OrderDetail from './pages/orders/OrderDetail';
import OrdersList from './pages/orders/OrdersList';
import PageEditor from './pages/content/PageEditor';
import PagesList from './pages/content/PagesList';
import ProductEditor from './pages/products/ProductEditor';
import ProductsList from './pages/products/ProductsList';
import ShippingPage from './pages/Shipping';
import StaffPage from './pages/Staff';
import { ButtonLink, Spinner } from './ui/Button';
import { EmptyState, ErrorBanner, Forbidden } from './ui/feedback';
import { ToastProvider, useToast } from './ui/Toasts';

export default function AdminApp() {
  const qc = useQueryClient();

  /* Admin-wide query defaults (the client itself belongs to the app shell).
     The storefront does not refetch when a tab is focused — a shopper's page
     has no reason to change under them. An admin does: the shop is being run
     from it, and often from more than one screen. Coming back to a tab that
     has been open for an hour and being shown what was true an hour ago is
     how you end up editing something that is no longer there. */
  useState(() => {
    qc.setQueryDefaults(qk.root, {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    });
    return null;
  });

  return (
    <div className="adm">
      <ToastProvider>
        <SessionWatch />
        <Gate />
      </ToastProvider>
    </div>
  );
}

/**
 * A 401 under any request means the session has expired or been revoked.
 * The app then swaps itself for the login screen — which, in the middle of
 * saving something, looks exactly like a save that did nothing. So it says
 * what happened, and says it inside the toast area, where the login screen
 * can still show it.
 */
function SessionWatch() {
  const qc = useQueryClient();
  const toast = useToast();

  useEffect(() => {
    const onError = (err: unknown) => {
      if (!(err instanceof ApiError) || err.status !== 401) return;
      if (!qc.getQueryData<AdminSessionDTO>(qk.session)?.staff) return;
      toast.error('Your session expired, so that was not saved. Sign in and try again.');
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
  }, [qc, toast]);

  return null;
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
          <Route path="inventory" element={<Guard perm="products:read"><InventoryPage /></Guard>} />
          <Route path="collections" element={<Guard perm="products:read"><CollectionsList /></Guard>} />
          <Route path="collections/new" element={<Guard perm="products:write"><CollectionEditor /></Guard>} />
          <Route path="collections/:id" element={<Guard perm="products:read"><CollectionEditor /></Guard>} />
          <Route path="customers" element={<Guard perm="customers:read"><CustomersList /></Guard>} />
          <Route path="customers/:id" element={<Guard perm="customers:read"><CustomerDetail /></Guard>} />
          <Route path="discounts" element={<Guard perm="discounts:read"><DiscountsList /></Guard>} />
          <Route path="discounts/new" element={<Guard perm="discounts:write"><DiscountEditor /></Guard>} />
          <Route path="discounts/:id" element={<Guard perm="discounts:read"><DiscountEditor /></Guard>} />
          <Route path="shipping" element={<Guard perm="shipping:write"><ShippingPage /></Guard>} />
          <Route path="website" element={<Guard perm="settings:write"><WebsiteHome /></Guard>} />
          <Route path="website/store" element={<Guard perm="settings:write"><WebsiteStore /></Guard>} />
          {/* the screen was called Home page before it grew into the whole site, and
              the store's own details were a Settings tab until they moved in with it */}
          <Route path="home" element={<Navigate to="/admin/website" replace />} />
          <Route path="settings" element={<Navigate to="/admin/website/store" replace />} />
          {/* taxes and the audit log are off the menu; their old links land on the dashboard.
              Tax is still applied at checkout from the rates already saved, and every staff
              action is still recorded — only the screens are gone. */}
          <Route path="taxes" element={<Navigate to="/admin" replace />} />
          <Route path="audit" element={<Navigate to="/admin" replace />} />
          <Route path="pages" element={<Guard perm="pages:write"><PagesList /></Guard>} />
          <Route path="pages/new" element={<Guard perm="pages:write"><PageEditor /></Guard>} />
          <Route path="pages/:id" element={<Guard perm="pages:write"><PageEditor /></Guard>} />
          <Route path="newsletter" element={<Guard perm="settings:write"><NewsletterPage /></Guard>} />
          <Route path="staff" element={<Guard perm="staff:manage"><StaffPage /></Guard>} />
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
