CREATE TABLE `privacy_page` (
	`id` text PRIMARY KEY NOT NULL,
	`singleton` integer DEFAULT 1 NOT NULL,
	`body_ja` text,
	`body_en` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "privacy_page_singleton" CHECK("privacy_page"."singleton" = 1),
	CONSTRAINT "privacy_page_body_ja" CHECK("privacy_page"."body_ja" is null or trim("privacy_page"."body_ja", char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)) <> ''),
	CONSTRAINT "privacy_page_body_en" CHECK("privacy_page"."body_en" is null or trim("privacy_page"."body_en", char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)) <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `privacy_page_singleton_unique` ON `privacy_page` (`singleton`);