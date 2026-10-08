-- Indexes for the sorts, filters and housekeeping scans that were reading whole
-- tables. Each one turns a full scan into an index range, so a cache miss on the
-- storefront — and the admin screens, and the five-minute hold sweep — reads the
-- rows it needs rather than the table. All additive and idempotent.

-- storefront: sort=title_asc (and the admin inventory list orders by title)
CREATE INDEX IF NOT EXISTS products_title ON products (title);

-- storefront: sort=created_desc ("newest")
CREATE INDEX IF NOT EXISTS products_created ON products (created_at);

-- /store policies row, asked for on every page load
CREATE INDEX IF NOT EXISTS pages_kind_published ON pages (kind, published);

-- /store menu and /collections, asked for on every page load
CREATE INDEX IF NOT EXISTS collections_published ON collections (published);

-- admin dashboard + inventory low-stock, and the low/out filters
CREATE INDEX IF NOT EXISTS variants_on_hand ON variants (inventory_on_hand);

-- the */5 cron that expires abandoned holds (DELETE WHERE expires_at <= ?)
CREATE INDEX IF NOT EXISTS inventory_reservations_expires ON inventory_reservations (expires_at);
