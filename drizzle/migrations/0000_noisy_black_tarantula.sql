CREATE TABLE "agent_sessions" (
	"session_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"prompt" text DEFAULT '' NOT NULL,
	"plan" text,
	"files" text DEFAULT '[]' NOT NULL,
	"logs" text DEFAULT '[]' NOT NULL,
	"state" text DEFAULT 'idle' NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_name" text NOT NULL,
	"provider" text NOT NULL,
	"deployment_url" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_connections" (
	"user_id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"encrypted_token" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "sandbox_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"commands" text DEFAULT '[]' NOT NULL,
	"result" text,
	"logs" text DEFAULT '[]' NOT NULL,
	"workspace_path" text DEFAULT '' NOT NULL,
	"mode" text DEFAULT 'local' NOT NULL,
	"policy" text DEFAULT '{}' NOT NULL,
	"resource_usage" text DEFAULT '{}' NOT NULL,
	"failure_summary" text DEFAULT '' NOT NULL,
	"created_at" bigint NOT NULL,
	"started_at" bigint,
	"updated_at" bigint NOT NULL,
	"completed_at" bigint
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text DEFAULT 'New Chat' NOT NULL,
	"messages" text DEFAULT '[]' NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"workspace_id" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"usage_limit" integer DEFAULT 100 NOT NULL,
	"created_at" bigint NOT NULL,
	"last_login" bigint,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"tree" text DEFAULT '[]' NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_connections" ADD CONSTRAINT "github_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_jobs" ADD CONSTRAINT "sandbox_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_sessions_user_idx" ON "agent_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "deployments_user_idx" ON "deployments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_hash_idx" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sandbox_jobs_user_idx" ON "sandbox_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sandbox_jobs_status_idx" ON "sandbox_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "workspaces_user_idx" ON "workspaces" USING btree ("user_id");