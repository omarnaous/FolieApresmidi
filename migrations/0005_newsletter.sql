CREATE TABLE `newsletter_campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`body_html` text NOT NULL,
	`status` text DEFAULT 'sending' NOT NULL,
	`recipients` integer DEFAULT 0 NOT NULL,
	`sent_count` integer DEFAULT 0 NOT NULL,
	`staff_id` text,
	`created_at` integer NOT NULL,
	`sent_at` integer,
	CONSTRAINT "newsletter_campaigns_status" CHECK("newsletter_campaigns"."status" in ('sending','sent'))
);
--> statement-breakpoint
CREATE INDEX `newsletter_campaigns_created` ON `newsletter_campaigns` (`created_at`);--> statement-breakpoint
ALTER TABLE `store_settings` ADD `newsletter_welcome_code` text;