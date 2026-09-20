CREATE TABLE `product_looks` (
	`product_id` text NOT NULL,
	`look_product_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`product_id`, `look_product_id`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`look_product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "product_looks_not_self" CHECK("product_looks"."product_id" != "product_looks"."look_product_id")
);
--> statement-breakpoint
CREATE INDEX `product_looks_position` ON `product_looks` (`product_id`,`position`);--> statement-breakpoint
CREATE INDEX `product_looks_look` ON `product_looks` (`look_product_id`);