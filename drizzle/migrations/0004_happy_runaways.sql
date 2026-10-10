CREATE TABLE `analytics_daily` (
	`date` text NOT NULL,
	`dimension` text NOT NULL,
	`key` text NOT NULL,
	`count` integer NOT NULL,
	`visitors` integer NOT NULL,
	PRIMARY KEY(`date`, `dimension`, `key`),
	CONSTRAINT "analytics_daily_dimension" CHECK("analytics_daily"."dimension" in ('total', 'page', 'referrer', 'utm', 'country', 'device', 'browser_lang', 'site_lang', 'top_view', 'section_view', 'read_complete', 'row_expand', 'paging', 'outbound', 'outbound_total', 'lang_switch', 'theme_switch', 'code_copy')),
	CONSTRAINT "analytics_daily_date" CHECK("analytics_daily"."date" glob '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]' and substr("analytics_daily"."date", 6, 2) between '01' and '12' and substr("analytics_daily"."date", 9, 2) between '01' and '31'),
	CONSTRAINT "analytics_daily_counts" CHECK("analytics_daily"."count" >= 0 and "analytics_daily"."visitors" >= 0 and "analytics_daily"."visitors" <= "analytics_daily"."count"),
	CONSTRAINT "analytics_daily_key" CHECK(("analytics_daily"."dimension" in ('total', 'top_view', 'outbound_total')) = ("analytics_daily"."key" = ''))
);
--> statement-breakpoint
CREATE INDEX `analytics_daily_dimension_date_idx` ON `analytics_daily` (`dimension`,`date`);--> statement-breakpoint
CREATE TABLE `analytics_rollup` (
	`date` text PRIMARY KEY NOT NULL,
	`rolled_up_at` integer NOT NULL,
	CONSTRAINT "analytics_rollup_date" CHECK("analytics_rollup"."date" glob '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]' and substr("analytics_rollup"."date", 6, 2) between '01' and '12' and substr("analytics_rollup"."date", 9, 2) between '01' and '31')
);
