-- Hand-written: things drizzle-kit cannot express.

-- Unique indexes over expressions: a country (or country + region) belongs to
-- one shipping zone; one tax rate per name per country/region.
CREATE UNIQUE INDEX `shipping_zone_regions_unique` ON `shipping_zone_regions` (`country_code`, coalesce(`region_code`, ''));--> statement-breakpoint
CREATE UNIQUE INDEX `tax_rates_unique` ON `tax_rates` (`country_code`, coalesce(`region_code`, ''), `name`);--> statement-breakpoint

-- Full-text search. unicode61 + remove_diacritics folds accents, so
-- "etagere" matches "Étagère". Rebuilt per product on every product write.
CREATE VIRTUAL TABLE `products_fts` USING fts5(
  product_id UNINDEXED,
  title,
  body,
  tags,
  options,
  skus,
  tokenize = 'unicode61 remove_diacritics 2'
);--> statement-breakpoint

-- The order audit trail is append-only.
CREATE TRIGGER `order_events_no_update` BEFORE UPDATE ON `order_events`
BEGIN
  SELECT RAISE(ABORT, 'order_events is append-only');
END;--> statement-breakpoint
CREATE TRIGGER `order_events_no_delete` BEFORE DELETE ON `order_events`
BEGIN
  SELECT RAISE(ABORT, 'order_events is append-only');
END;--> statement-breakpoint

-- Singletons every environment needs before the first request.
INSERT OR IGNORE INTO `order_counters` (`id`, `next_number`) VALUES (1, 1001);--> statement-breakpoint
INSERT OR IGNORE INTO `store_settings` (`id`, `name`, `currency`, `prices_include_tax`, `menu_json`, `updated_at`)
VALUES (1, 'Store', 'USD', 1, '[]', 0);
