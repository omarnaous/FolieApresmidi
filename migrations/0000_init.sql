-- The first single-file Worker created `orders` and `subscribers` with a
-- different shape (and no migration history). Both were verified empty on
-- 2026-09-15 before this migration was written.
DROP TABLE IF EXISTS `orders`;--> statement-breakpoint
DROP TABLE IF EXISTS `subscribers`;--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`staff_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`summary` text NOT NULL,
	`diff_json` text,
	`ip` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_created` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_log_entity` ON `audit_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `auth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`purpose` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_tokens_token_hash_unique` ON `auth_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `auth_tokens_subject` ON `auth_tokens` (`subject_type`,`subject_id`,`purpose`,`created_at`);--> statement-breakpoint
CREATE TABLE `cart_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`cart_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`cart_id`) REFERENCES `carts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cart_lines_quantity" CHECK("cart_lines"."quantity" between 1 and 99)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cart_lines_variant` ON `cart_lines` (`cart_id`,`variant_id`);--> statement-breakpoint
CREATE TABLE `carts` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text,
	`email` text,
	`discount_code` text,
	`status` text DEFAULT 'active' NOT NULL,
	`converted_order_id` text,
	`reminder_sent_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `carts_customer` ON `carts` (`customer_id`,`status`);--> statement-breakpoint
CREATE INDEX `carts_status_updated` ON `carts` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `checkouts` (
	`id` text PRIMARY KEY NOT NULL,
	`cart_id` text NOT NULL,
	`customer_id` text,
	`email` text,
	`phone` text,
	`accepts_marketing` integer DEFAULT false NOT NULL,
	`shipping_address_json` text,
	`shipping_rate_id` text,
	`discount_code` text,
	`note` text,
	`lines_json` text NOT NULL,
	`pricing_json` text,
	`total_amount` integer DEFAULT 0 NOT NULL,
	`currency` text NOT NULL,
	`provider` text,
	`provider_ref` text,
	`status` text DEFAULT 'open' NOT NULL,
	`expires_at` integer NOT NULL,
	`order_id` text,
	`order_token` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "checkouts_status" CHECK("checkouts"."status" in ('open','completed','expired'))
);
--> statement-breakpoint
CREATE INDEX `checkouts_cart` ON `checkouts` (`cart_id`);--> statement-breakpoint
CREATE INDEX `checkouts_status_expires` ON `checkouts` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `collection_products` (
	`collection_id` text NOT NULL,
	`product_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`collection_id`, `product_id`),
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `collection_products_product` ON `collection_products` (`product_id`);--> statement-breakpoint
CREATE INDEX `collection_products_position` ON `collection_products` (`collection_id`,`position`);--> statement-breakpoint
CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`title` text NOT NULL,
	`description_html` text DEFAULT '' NOT NULL,
	`type` text NOT NULL,
	`rules_json` text DEFAULT '{"match":"all","conditions":[]}' NOT NULL,
	`sort` text DEFAULT 'manual' NOT NULL,
	`image_media_id` text,
	`published` integer DEFAULT true NOT NULL,
	`seo_title` text,
	`seo_description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "collections_type" CHECK("collections"."type" in ('manual','smart'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collections_handle_unique` ON `collections` (`handle`);--> statement-breakpoint
CREATE TABLE `csv_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`staff_id` text,
	`r2_key` text NOT NULL,
	`status` text NOT NULL,
	`summary_json` text,
	`errors_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE TABLE `customer_addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`line1` text NOT NULL,
	`line2` text DEFAULT '' NOT NULL,
	`city` text NOT NULL,
	`region` text,
	`postal_code` text,
	`country_code` text NOT NULL,
	`notes` text,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `customer_addresses_customer` ON `customer_addresses` (`customer_id`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text,
	`name` text DEFAULT '' NOT NULL,
	`phone` text,
	`email_verified_at` integer,
	`accepts_marketing` integer DEFAULT false NOT NULL,
	`session_epoch` integer DEFAULT 0 NOT NULL,
	`note` text,
	`orders_count` integer DEFAULT 0 NOT NULL,
	`total_spent_amount` integer DEFAULT 0 NOT NULL,
	`last_order_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_email_unique` ON `customers` (`email`);--> statement-breakpoint
CREATE INDEX `customers_created` ON `customers` (`created_at`);--> statement-breakpoint
CREATE INDEX `customers_spent` ON `customers` (`total_spent_amount`);--> statement-breakpoint
CREATE TABLE `discount_redemptions` (
	`id` text PRIMARY KEY NOT NULL,
	`discount_id` text NOT NULL,
	`order_id` text NOT NULL,
	`customer_id` text,
	`email` text NOT NULL,
	`amount` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discount_redemptions_order` ON `discount_redemptions` (`discount_id`,`order_id`);--> statement-breakpoint
CREATE INDEX `discount_redemptions_email` ON `discount_redemptions` (`discount_id`,`email`);--> statement-breakpoint
CREATE TABLE `discount_targets` (
	`discount_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`discount_id`, `target_type`, `target_id`, `role`),
	FOREIGN KEY (`discount_id`) REFERENCES `discounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `discounts` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`type` text NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	`applies_to` text DEFAULT 'all' NOT NULL,
	`min_subtotal_amount` integer,
	`min_quantity` integer,
	`usage_limit` integer,
	`usage_limit_per_customer` integer,
	`usage_count` integer DEFAULT 0 NOT NULL,
	`buy_quantity` integer,
	`get_quantity` integer,
	`max_uses_per_order` integer,
	`starts_at` integer NOT NULL,
	`ends_at` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "discounts_type" CHECK("discounts"."type" in ('percentage','fixed_amount','free_shipping','buy_x_get_y')),
	CONSTRAINT "discounts_usage" CHECK("discounts"."usage_limit" IS NULL OR "discounts"."usage_count" <= "discounts"."usage_limit")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discounts_code_unique` ON `discounts` (`code`);--> statement-breakpoint
CREATE TABLE `fulfillment_lines` (
	`fulfillment_id` text NOT NULL,
	`order_line_id` text NOT NULL,
	`quantity` integer NOT NULL,
	PRIMARY KEY(`fulfillment_id`, `order_line_id`),
	FOREIGN KEY (`fulfillment_id`) REFERENCES `fulfillments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `fulfillments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`status` text NOT NULL,
	`carrier` text,
	`tracking_number` text,
	`tracking_url` text,
	`shipped_at` integer,
	`delivered_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `fulfillments_order` ON `fulfillments` (`order_id`);--> statement-breakpoint
CREATE TABLE `inventory_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`delta` integer NOT NULL,
	`reason` text NOT NULL,
	`order_id` text,
	`staff_id` text,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `inventory_adjustments_variant` ON `inventory_adjustments` (`variant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `inventory_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`checkout_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `inventory_reservations_variant` ON `inventory_reservations` (`variant_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `inventory_reservations_checkout` ON `inventory_reservations` (`checkout_id`);--> statement-breakpoint
CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`r2_key` text NOT NULL,
	`source_url` text,
	`mime` text NOT NULL,
	`bytes` integer,
	`width` integer,
	`height` integer,
	`alt` text DEFAULT '' NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_r2_key_unique` ON `media` (`r2_key`);--> statement-breakpoint
CREATE TABLE `order_counters` (
	`id` integer PRIMARY KEY NOT NULL,
	`next_number` integer NOT NULL,
	CONSTRAINT "order_counters_singleton" CHECK("order_counters"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `order_events` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`type` text NOT NULL,
	`from_status` text,
	`to_status` text,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`message` text NOT NULL,
	`data_json` text,
	`customer_visible` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `order_events_order` ON `order_events` (`order_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`product_id` text,
	`variant_id` text,
	`product_handle` text,
	`title` text NOT NULL,
	`variant_title` text DEFAULT '' NOT NULL,
	`sku` text,
	`media_id` text,
	`quantity` integer NOT NULL,
	`unit_price_amount` integer NOT NULL,
	`discount_amount` integer DEFAULT 0 NOT NULL,
	`tax_amount` integer DEFAULT 0 NOT NULL,
	`total_amount` integer NOT NULL,
	`requires_shipping` integer DEFAULT true NOT NULL,
	`inventory_tracked` integer DEFAULT true NOT NULL,
	`fulfilled_quantity` integer DEFAULT 0 NOT NULL,
	`refunded_quantity` integer DEFAULT 0 NOT NULL,
	`restocked_quantity` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "order_lines_refunded" CHECK("order_lines"."refunded_quantity" >= 0 AND "order_lines"."refunded_quantity" <= "order_lines"."quantity"),
	CONSTRAINT "order_lines_restocked" CHECK("order_lines"."restocked_quantity" >= 0 AND "order_lines"."restocked_quantity" <= "order_lines"."quantity")
);
--> statement-breakpoint
CREATE INDEX `order_lines_order` ON `order_lines` (`order_id`);--> statement-breakpoint
CREATE INDEX `order_lines_product` ON `order_lines` (`product_id`);--> statement-breakpoint
CREATE TABLE `order_tax_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`order_line_id` text,
	`name` text NOT NULL,
	`rate_bps` integer NOT NULL,
	`amount` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `order_tax_lines_order` ON `order_tax_lines` (`order_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`number` integer NOT NULL,
	`checkout_id` text,
	`customer_id` text,
	`email` text NOT NULL,
	`phone` text,
	`status` text NOT NULL,
	`payment_status` text NOT NULL,
	`provider` text NOT NULL,
	`provider_ref` text,
	`currency` text NOT NULL,
	`subtotal_amount` integer NOT NULL,
	`discount_amount` integer DEFAULT 0 NOT NULL,
	`shipping_amount` integer DEFAULT 0 NOT NULL,
	`shipping_discount_amount` integer DEFAULT 0 NOT NULL,
	`tax_amount` integer DEFAULT 0 NOT NULL,
	`total_amount` integer NOT NULL,
	`refunded_amount` integer DEFAULT 0 NOT NULL,
	`prices_include_tax` integer NOT NULL,
	`pricing_json` text NOT NULL,
	`shipping_address_json` text,
	`shipping_method` text,
	`discount_codes_json` text DEFAULT '[]' NOT NULL,
	`note` text,
	`access_token_hash` text NOT NULL,
	`user_agent` text,
	`cancel_reason` text,
	`cancelled_at` integer,
	`placed_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "orders_status" CHECK("orders"."status" in ('pending','paid','fulfilled','shipped','delivered','cancelled','refunded')),
	CONSTRAINT "orders_payment_status" CHECK("orders"."payment_status" in ('unpaid','paid','partially_refunded','refunded')),
	CONSTRAINT "orders_refund_cap" CHECK("orders"."refunded_amount" >= 0 AND "orders"."refunded_amount" <= "orders"."total_amount")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_number_unique` ON `orders` (`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_checkout_id_unique` ON `orders` (`checkout_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_access_token_hash_unique` ON `orders` (`access_token_hash`);--> statement-breakpoint
CREATE INDEX `orders_status_placed` ON `orders` (`status`,`placed_at`);--> statement-breakpoint
CREATE INDEX `orders_customer_placed` ON `orders` (`customer_id`,`placed_at`);--> statement-breakpoint
CREATE INDEX `orders_email` ON `orders` (`email`);--> statement-breakpoint
CREATE INDEX `orders_placed` ON `orders` (`placed_at`);--> statement-breakpoint
CREATE TABLE `pages` (
	`id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`kind` text DEFAULT 'page' NOT NULL,
	`title` text NOT NULL,
	`body_html` text DEFAULT '' NOT NULL,
	`published` integer DEFAULT true NOT NULL,
	`seo_title` text,
	`seo_description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "pages_kind" CHECK("pages"."kind" in ('policy','page'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_handle_unique` ON `pages` (`handle`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text,
	`checkout_id` text,
	`provider` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`provider_ref` text,
	`error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `payments_order` ON `payments` (`order_id`);--> statement-breakpoint
CREATE TABLE `product_media` (
	`product_id` text NOT NULL,
	`media_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`product_id`, `media_id`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `product_media_position` ON `product_media` (`product_id`,`position`);--> statement-breakpoint
CREATE TABLE `product_option_values` (
	`id` text PRIMARY KEY NOT NULL,
	`option_id` text NOT NULL,
	`value` text NOT NULL,
	`position` integer NOT NULL,
	`swatch` text,
	FOREIGN KEY (`option_id`) REFERENCES `product_options`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_option_values_value` ON `product_option_values` (`option_id`,`value`);--> statement-breakpoint
CREATE TABLE `product_options` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_options_position` ON `product_options` (`product_id`,`position`);--> statement-breakpoint
CREATE TABLE `product_tags` (
	`product_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`product_id`, `tag_id`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `product_tags_tag` ON `product_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`title` text NOT NULL,
	`description_html` text DEFAULT '' NOT NULL,
	`description_text` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`product_type` text DEFAULT '' NOT NULL,
	`vendor` text,
	`seo_title` text,
	`seo_description` text,
	`position` integer DEFAULT 0 NOT NULL,
	`published_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "products_status" CHECK("products"."status" in ('draft','active','archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_handle_unique` ON `products` (`handle`);--> statement-breakpoint
CREATE INDEX `products_status_position` ON `products` (`status`,`position`);--> statement-breakpoint
CREATE INDEX `products_type` ON `products` (`product_type`);--> statement-breakpoint
CREATE TABLE `refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text,
	`restock` integer DEFAULT false NOT NULL,
	`lines_json` text DEFAULT '[]' NOT NULL,
	`provider_ref` text,
	`status` text NOT NULL,
	`staff_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `refunds_order` ON `refunds` (`order_id`);--> statement-breakpoint
CREATE TABLE `shipping_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`zone_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`amount` integer NOT NULL,
	`min_value` integer,
	`max_value` integer,
	`delivery_estimate` text,
	`active` integer DEFAULT true NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`zone_id`) REFERENCES `shipping_zones`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "shipping_rates_type" CHECK("shipping_rates"."type" in ('flat','weight','price'))
);
--> statement-breakpoint
CREATE INDEX `shipping_rates_zone` ON `shipping_rates` (`zone_id`);--> statement-breakpoint
CREATE TABLE `shipping_zone_regions` (
	`id` text PRIMARY KEY NOT NULL,
	`zone_id` text NOT NULL,
	`country_code` text NOT NULL,
	`region_code` text,
	FOREIGN KEY (`zone_id`) REFERENCES `shipping_zones`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `shipping_zone_regions_zone` ON `shipping_zone_regions` (`zone_id`);--> statement-breakpoint
CREATE TABLE `shipping_zones` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `staff_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`permissions_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'invited' NOT NULL,
	`session_epoch` integer DEFAULT 0 NOT NULL,
	`last_login_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "staff_role" CHECK("staff_users"."role" in ('owner','admin','staff')),
	CONSTRAINT "staff_status" CHECK("staff_users"."status" in ('invited','active','disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_users_email_unique` ON `staff_users` (`email`);--> statement-breakpoint
CREATE TABLE `store_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`prices_include_tax` integer DEFAULT true NOT NULL,
	`contact_email` text,
	`contact_phone` text,
	`instagram` text,
	`address` text,
	`logo_media_id` text,
	`menu_json` text DEFAULT '[]' NOT NULL,
	`featured_collection_handle` text,
	`lookbook_collection_handle` text,
	`editorial_collection_handle` text,
	`low_stock_threshold` integer DEFAULT 3 NOT NULL,
	`checkout_hold_minutes` integer DEFAULT 15 NOT NULL,
	`abandoned_cart_emails` integer DEFAULT true NOT NULL,
	`order_notification_email` text,
	`updated_at` integer NOT NULL,
	CONSTRAINT "store_settings_singleton" CHECK("store_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `subscribers` (
	`email` text PRIMARY KEY NOT NULL,
	`customer_id` text,
	`source` text NOT NULL,
	`status` text DEFAULT 'subscribed' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_lower` ON `tags` (lower("name"));--> statement-breakpoint
CREATE TABLE `tax_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`country_code` text NOT NULL,
	`region_code` text,
	`name` text NOT NULL,
	`rate_bps` integer NOT NULL,
	`applies_to_shipping` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "tax_rates_bps" CHECK("tax_rates"."rate_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE INDEX `tax_rates_country` ON `tax_rates` (`country_code`);--> statement-breakpoint
CREATE TABLE `variants` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`sku` text,
	`title` text NOT NULL,
	`option1` text,
	`option2` text,
	`option3` text,
	`price_amount` integer NOT NULL,
	`compare_at_amount` integer,
	`cost_amount` integer,
	`weight_grams` integer DEFAULT 0 NOT NULL,
	`requires_shipping` integer DEFAULT true NOT NULL,
	`taxable` integer DEFAULT true NOT NULL,
	`inventory_tracked` integer DEFAULT true NOT NULL,
	`inventory_policy` text DEFAULT 'deny' NOT NULL,
	`inventory_on_hand` integer DEFAULT 0 NOT NULL,
	`media_id` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "variants_price" CHECK("variants"."price_amount" >= 0),
	CONSTRAINT "variants_policy" CHECK("variants"."inventory_policy" in ('deny','continue')),
	CONSTRAINT "variants_stock" CHECK("variants"."inventory_on_hand" >= 0 OR "variants"."inventory_policy" = 'continue' OR "variants"."inventory_tracked" = 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `variants_sku_unique` ON `variants` (`sku`);--> statement-breakpoint
CREATE INDEX `variants_product` ON `variants` (`product_id`,`position`);--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`provider` text NOT NULL,
	`event_id` text NOT NULL,
	`type` text NOT NULL,
	`received_at` integer NOT NULL,
	PRIMARY KEY(`provider`, `event_id`)
);
--> statement-breakpoint
CREATE INDEX `webhook_events_received` ON `webhook_events` (`received_at`);--> statement-breakpoint
CREATE TABLE `wishlist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`product_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wishlist_items_unique` ON `wishlist_items` (`customer_id`,`product_id`);