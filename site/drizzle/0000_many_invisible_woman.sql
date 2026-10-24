CREATE TABLE `nav_refresh` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` integer NOT NULL,
	`lease_until` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `nav_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL
);
