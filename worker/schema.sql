-- FDM store schema. Applied to the remote D1 already; kept here so a fresh
-- database (or the local one wrangler uses) can be built from scratch:
--   npx wrangler d1 execute fdm-store --local  --file=worker/schema.sql
--   npx wrangler d1 execute fdm-store --remote --file=worker/schema.sql

CREATE TABLE IF NOT EXISTS orders (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  status      TEXT NOT NULL DEFAULT 'new',
  payment     TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'USD',
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL,
  email       TEXT NOT NULL,
  city        TEXT NOT NULL,
  area        TEXT NOT NULL,
  building    TEXT NOT NULL,
  notes       TEXT,
  items       TEXT NOT NULL,
  user_agent  TEXT
);

CREATE TABLE IF NOT EXISTS subscribers (
  email      TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  source     TEXT
);

CREATE INDEX IF NOT EXISTS orders_created_at ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status ON orders (status);
