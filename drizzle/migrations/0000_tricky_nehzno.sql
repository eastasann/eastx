CREATE TABLE `admin_account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `admin_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_account_provider_unique` ON `admin_account` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `admin_session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `admin_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_session_token_unique` ON `admin_session` (`token`);--> statement-breakpoint
CREATE INDEX `admin_session_user_idx` ON `admin_session` (`user_id`);--> statement-breakpoint
CREATE TABLE `admin_user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`github_user_id` text NOT NULL,
	`github_login` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_user_email_unique` ON `admin_user` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `admin_user_github_user_id_unique` ON `admin_user` (`github_user_id`);--> statement-breakpoint
CREATE TABLE `auth_verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_verification_identifier_idx` ON `auth_verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `blog_post` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text,
	`title_ja` text,
	`title_en` text,
	`body_ja` text,
	`body_en` text,
	`thumbnail_url` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`published_at` integer,
	`content_updated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "blog_post_slug_format" CHECK("blog_post"."slug" is null or ("blog_post"."slug" <> '' and "blog_post"."slug" not glob '*[^a-z0-9-]*')),
	CONSTRAINT "blog_post_status" CHECK("blog_post"."status" in ('draft', 'published')),
	CONSTRAINT "blog_post_title_required" CHECK("blog_post"."title_ja" is not null or "blog_post"."title_en" is not null),
	CONSTRAINT "blog_post_published" CHECK("blog_post"."status" <> 'published' or ("blog_post"."slug" is not null and "blog_post"."published_at" is not null)),
	CONSTRAINT "blog_post_thumbnail_url" CHECK("blog_post"."thumbnail_url" is null or "blog_post"."thumbnail_url" glob '/media/*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blog_post_slug_unique` ON `blog_post` (`slug`);--> statement-breakpoint
CREATE INDEX `blog_post_status_published_idx` ON `blog_post` (`status`,`published_at`);--> statement-breakpoint
CREATE TABLE `career` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'work' NOT NULL,
	`title_ja` text,
	`title_en` text,
	`organization_ja` text,
	`organization_en` text,
	`location_ja` text,
	`location_en` text,
	`body_ja` text,
	`body_en` text,
	`start_date` text,
	`end_date` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "career_kind" CHECK("career"."kind" in ('work', 'education')),
	CONSTRAINT "career_status" CHECK("career"."status" in ('draft', 'published')),
	CONSTRAINT "career_title_required" CHECK("career"."title_ja" is not null or "career"."title_en" is not null),
	CONSTRAINT "career_start_date" CHECK("career"."start_date" is null or ("career"."start_date" glob '[0-9][0-9][0-9][0-9]-[01][0-9]' and substr("career"."start_date", 6, 2) between '01' and '12')),
	CONSTRAINT "career_end_date" CHECK("career"."end_date" is null or ("career"."end_date" glob '[0-9][0-9][0-9][0-9]-[01][0-9]' and substr("career"."end_date", 6, 2) between '01' and '12')),
	CONSTRAINT "career_period" CHECK("career"."start_date" is null or "career"."end_date" is null or "career"."end_date" >= "career"."start_date"),
	CONSTRAINT "career_published_start" CHECK("career"."status" <> 'published' or "career"."start_date" is not null)
);
--> statement-breakpoint
CREATE INDEX `career_status_start_idx` ON `career` (`status`,`start_date`);--> statement-breakpoint
CREATE TABLE `coding_log` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text,
	`kind` text DEFAULT 'learning_log' NOT NULL,
	`title_ja` text,
	`title_en` text,
	`body_ja` text,
	`body_en` text,
	`reference_url` text,
	`thumbnail_url` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`published_at` integer,
	`content_updated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "coding_log_slug_format" CHECK("coding_log"."slug" is null or ("coding_log"."slug" <> '' and "coding_log"."slug" not glob '*[^a-z0-9-]*')),
	CONSTRAINT "coding_log_kind" CHECK("coding_log"."kind" in ('learning_log', 'snippet', 'problem', 'memo')),
	CONSTRAINT "coding_log_status" CHECK("coding_log"."status" in ('draft', 'published')),
	CONSTRAINT "coding_log_title_required" CHECK("coding_log"."title_ja" is not null or "coding_log"."title_en" is not null),
	CONSTRAINT "coding_log_published" CHECK("coding_log"."status" <> 'published' or ("coding_log"."slug" is not null and "coding_log"."published_at" is not null)),
	CONSTRAINT "coding_log_reference_url" CHECK("coding_log"."reference_url" is null or "coding_log"."reference_url" glob 'https://*'),
	CONSTRAINT "coding_log_thumbnail_url" CHECK("coding_log"."thumbnail_url" is null or "coding_log"."thumbnail_url" glob '/media/*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coding_log_slug_unique` ON `coding_log` (`slug`);--> statement-breakpoint
CREATE INDEX `coding_log_status_published_idx` ON `coding_log` (`status`,`published_at`);--> statement-breakpoint
CREATE TABLE `profile` (
	`id` text PRIMARY KEY NOT NULL,
	`singleton` integer DEFAULT 1 NOT NULL,
	`name_ja` text,
	`name_en` text,
	`headline_ja` text,
	`headline_en` text,
	`bio_ja` text,
	`bio_en` text,
	`avatar_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "profile_singleton" CHECK("profile"."singleton" = 1),
	CONSTRAINT "profile_name_required" CHECK("profile"."name_ja" is not null or "profile"."name_en" is not null),
	CONSTRAINT "profile_avatar_url" CHECK("profile"."avatar_url" is null or "profile"."avatar_url" glob '/media/*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_singleton_unique` ON `profile` (`singleton`);--> statement-breakpoint
CREATE TABLE `project` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text,
	`title_ja` text,
	`title_en` text,
	`summary_ja` text,
	`summary_en` text,
	`body_ja` text,
	`body_en` text,
	`thumbnail_url` text,
	`link_url` text,
	`start_date` text,
	`end_date` text,
	`sort_order` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`first_published_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "project_slug_format" CHECK("project"."slug" is null or ("project"."slug" <> '' and "project"."slug" not glob '*[^a-z0-9-]*')),
	CONSTRAINT "project_status" CHECK("project"."status" in ('draft', 'published')),
	CONSTRAINT "project_title_required" CHECK("project"."title_ja" is not null or "project"."title_en" is not null),
	CONSTRAINT "project_published_slug" CHECK("project"."status" <> 'published' or "project"."slug" is not null),
	CONSTRAINT "project_published_start" CHECK("project"."status" <> 'published' or "project"."start_date" is not null),
	CONSTRAINT "project_start_date" CHECK("project"."start_date" is null or ("project"."start_date" glob '[0-9][0-9][0-9][0-9]-[01][0-9]' and substr("project"."start_date", 6, 2) between '01' and '12')),
	CONSTRAINT "project_end_date" CHECK("project"."end_date" is null or ("project"."end_date" glob '[0-9][0-9][0-9][0-9]-[01][0-9]' and substr("project"."end_date", 6, 2) between '01' and '12')),
	CONSTRAINT "project_period" CHECK("project"."start_date" is null or "project"."end_date" is null or "project"."end_date" >= "project"."start_date"),
	CONSTRAINT "project_link_url" CHECK("project"."link_url" is null or "project"."link_url" glob 'https://*'),
	CONSTRAINT "project_thumbnail_url" CHECK("project"."thumbnail_url" is null or "project"."thumbnail_url" glob '/media/*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_slug_unique` ON `project` (`slug`);--> statement-breakpoint
CREATE INDEX `project_status_sort_idx` ON `project` (`status`,`sort_order`);--> statement-breakpoint
CREATE TABLE `project_stack` (
	`project_id` text NOT NULL,
	`stack_id` text NOT NULL,
	`sort_order` integer NOT NULL,
	PRIMARY KEY(`project_id`, `stack_id`),
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`stack_id`) REFERENCES `stack`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_stack_stack_idx` ON `project_stack` (`stack_id`);--> statement-breakpoint
CREATE TABLE `social_link` (
	`id` text PRIMARY KEY NOT NULL,
	`service` text NOT NULL,
	`url` text NOT NULL,
	`label` text,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "social_link_service" CHECK("social_link"."service" in ('github', 'linkedin', 'instagram', 'x', 'zenn', 'qiita', 'other')),
	CONSTRAINT "social_link_url" CHECK("social_link"."url" glob 'https://*'),
	CONSTRAINT "social_link_other_label" CHECK("social_link"."service" <> 'other' or "social_link"."label" is not null)
);
--> statement-breakpoint
CREATE INDEX `social_link_sort_idx` ON `social_link` (`sort_order`);--> statement-breakpoint
CREATE TABLE `stack` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`display_name` text NOT NULL,
	`icon_url` text,
	`link_url` text,
	`sort_order` integer NOT NULL,
	`show_on_top` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "stack_key_format" CHECK("stack"."key" <> '' and "stack"."key" not glob '*[^a-z0-9-]*'),
	CONSTRAINT "stack_link_url" CHECK("stack"."link_url" is null or "stack"."link_url" glob 'https://*'),
	CONSTRAINT "stack_icon_url" CHECK("stack"."icon_url" is null or "stack"."icon_url" glob '/media/*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stack_key_unique` ON `stack` (`key`);--> statement-breakpoint
CREATE INDEX `stack_sort_idx` ON `stack` (`sort_order`);--> statement-breakpoint
CREATE TABLE `work` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text,
	`title_ja` text,
	`title_en` text,
	`summary_ja` text,
	`summary_en` text,
	`body_ja` text,
	`body_en` text,
	`thumbnail_url` text,
	`link_url` text,
	`github_url` text,
	`sort_order` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`first_published_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "work_slug_format" CHECK("work"."slug" is null or ("work"."slug" <> '' and "work"."slug" not glob '*[^a-z0-9-]*')),
	CONSTRAINT "work_status" CHECK("work"."status" in ('draft', 'published')),
	CONSTRAINT "work_title_required" CHECK("work"."title_ja" is not null or "work"."title_en" is not null),
	CONSTRAINT "work_published_slug" CHECK("work"."status" <> 'published' or "work"."slug" is not null),
	CONSTRAINT "work_link_url" CHECK("work"."link_url" is null or "work"."link_url" glob 'https://*'),
	CONSTRAINT "work_github_url" CHECK("work"."github_url" is null or "work"."github_url" glob 'https://*'),
	CONSTRAINT "work_thumbnail_url" CHECK("work"."thumbnail_url" is null or "work"."thumbnail_url" glob '/media/*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_slug_unique` ON `work` (`slug`);--> statement-breakpoint
CREATE INDEX `work_status_sort_idx` ON `work` (`status`,`sort_order`);--> statement-breakpoint
CREATE TABLE `work_stack` (
	`work_id` text NOT NULL,
	`stack_id` text NOT NULL,
	`sort_order` integer NOT NULL,
	PRIMARY KEY(`work_id`, `stack_id`),
	FOREIGN KEY (`work_id`) REFERENCES `work`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`stack_id`) REFERENCES `stack`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `work_stack_stack_idx` ON `work_stack` (`stack_id`);