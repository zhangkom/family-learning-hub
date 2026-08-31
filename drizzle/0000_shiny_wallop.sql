CREATE TABLE `scan_items` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`child` text NOT NULL,
	`subject` text NOT NULL,
	`source` text NOT NULL,
	`original_name` text NOT NULL,
	`object_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`status` text DEFAULT '待讲解' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scan_items_object_key_unique` ON `scan_items` (`object_key`);--> statement-breakpoint
CREATE INDEX `scan_owner_child_created_idx` ON `scan_items` (`owner_id`,`child`,`created_at`);--> statement-breakpoint
CREATE TABLE `wrong_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`child` text NOT NULL,
	`subject` text NOT NULL,
	`question_id` text NOT NULL,
	`knowledge_point` text NOT NULL,
	`prompt` text NOT NULL,
	`answer` text NOT NULL,
	`learner_answer` text NOT NULL,
	`source` text NOT NULL,
	`status` text DEFAULT '待重做' NOT NULL,
	`review_dates` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `wrong_owner_child_created_idx` ON `wrong_questions` (`owner_id`,`child`,`created_at`);