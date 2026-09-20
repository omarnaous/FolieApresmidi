import { Hono } from 'hono';
import { apiNotFound, apiSecurityHeaders, context, noStoreByDefault, onError } from './middleware/core';
import { csrf } from './middleware/csrf';
import { rateLimit } from './middleware/rate-limit';
import { loadStaff } from './middleware/session';
import { adminAuth } from './routes/admin/auth';
import { adminCollections } from './routes/admin/collections';
import { adminCustomers } from './routes/admin/customers';
import { adminDashboard } from './routes/admin/dashboard';
import { adminDiscounts } from './routes/admin/discounts';
import { adminInventory } from './routes/admin/inventory';
import { adminNewsletter } from './routes/admin/newsletter';
import { adminOrders } from './routes/admin/orders';
import { adminProducts } from './routes/admin/products';
import { adminSettings } from './routes/admin/settings';
import { adminShipping } from './routes/admin/shipping';
import { adminStaff } from './routes/admin/staff';
import { cart } from './routes/cart';
import { checkout } from './routes/checkout';
import { dev } from './routes/dev';
import { media } from './routes/media';
import { seo } from './routes/seo';
import { session } from './routes/session';
import { store } from './routes/store';
import { webhooks } from './routes/webhooks';
import type { AppEnv } from './types';

/*
 * Request flow
 *   every request    context (request id, db) → error handler
 *   /api/*           security headers → private/no-store default → per-IP ceiling
 *                    → CSRF (writes) → staff session under /api/admin (the store has no accounts)
 *   /media/*         image pipeline (R2 + Images), immutable
 *   /film/*          the hero film, with byte ranges
 *   /products/*, /collections/*, /pages/*, /sitemap.xml, /robots.txt, /cart/recover/*
 *                    HTML with server-rendered head, or small documents
 *   anything else    static assets (the SPA)
 */

const api = new Hono<AppEnv>();
api.use('*', apiSecurityHeaders, noStoreByDefault, rateLimit('RL_API'), csrf);
api.use('*', async (c, next) => (c.req.path.startsWith('/api/admin') ? loadStaff(c, next) : next()));

api.route('/', store);
api.route('/', cart);
api.route('/', checkout);
api.route('/', session);
api.route('/', webhooks);
api.route('/', dev);

const admin = new Hono<AppEnv>();
admin.route('/', adminAuth);
admin.route('/', adminDashboard);
admin.route('/', adminProducts);
admin.route('/', adminInventory);
admin.route('/', adminCollections);
admin.route('/', adminOrders);
admin.route('/', adminCustomers);
admin.route('/', adminDiscounts);
admin.route('/', adminShipping);
admin.route('/', adminSettings);
admin.route('/', adminNewsletter);
admin.route('/', adminStaff);
api.route('/admin', admin);

export const app = new Hono<AppEnv>();
app.use('*', context);
app.onError(onError);
app.route('/api', api);
app.route('/', media);
app.route('/', seo);
app.notFound((c) => (c.req.path.startsWith('/api/') ? apiNotFound(c) : c.env.ASSETS.fetch(c.req.raw)));
