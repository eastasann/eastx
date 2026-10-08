ALTER TABLE `stack` ADD `category` text DEFAULT 'tools' NOT NULL CONSTRAINT "stack_category" CHECK("stack"."category" in ('languages', 'frameworks', 'infrastructure', 'tools'));--> statement-breakpoint
ALTER TABLE `stack` ADD `is_core` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `stack` SET `category` = 'languages' WHERE `key` IN ('typescript', 'javascript', 'python', 'html', 'css', 'sass', 'graphql');--> statement-breakpoint
UPDATE `stack` SET `category` = 'frameworks' WHERE `key` IN ('react', 'vue', 'svelte', 'next', 'jquery', 'redux', 'apollo', 'socketio', 'styled-components', 'emotion', 'tailwind', 'materialui', 'mantine', 'electron', 'capacitor', 'express', 'prisma');--> statement-breakpoint
UPDATE `stack` SET `category` = 'infrastructure' WHERE `key` IN ('node', 'firebase', 'gcp', 'aws', 'docker', 'supabase', 'railway', 'vercel', 'auth0');
