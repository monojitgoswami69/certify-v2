CREATE TABLE "mail_batch_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"certificate_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"recipient_order" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"resend_version" uuid,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"submitted_to_gmail_at" timestamp with time zone,
	"error_code" text,
	"error_detail" text,
	"gmail_message_id" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_batch_items_status_check" CHECK ("mail_batch_items"."status" in ('queued', 'rendering', 'sending', 'accepted', 'failed', 'unknown', 'skipped', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "mail_batch_oauth_handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"state_hash" text NOT NULL,
	"encrypted_verifier" text,
	"encrypted_code" text,
	"redirect_uri" text NOT NULL,
	"callback_received_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"sender_email" text NOT NULL,
	"sender_name" text NOT NULL,
	"status" text DEFAULT 'awaiting_auth' NOT NULL,
	"mail_preferences" jsonb NOT NULL,
	"total_items" integer NOT NULL,
	"verification_origin" text,
	"lease_owner" text,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"auth_expires_at" timestamp with time zone,
	"status_reason" text,
	"peak_memory_mb" integer,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_batches_status_check" CHECK ("mail_batches"."status" in ('awaiting_auth', 'queued', 'running', 'paused_auth', 'paused_rate_limit', 'cancelling', 'cancelled', 'completed', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "mail_batch_items" ADD CONSTRAINT "mail_batch_items_batch_id_mail_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."mail_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_batch_items" ADD CONSTRAINT "mail_batch_items_certificate_id_certificates_id_fk" FOREIGN KEY ("certificate_id") REFERENCES "public"."certificates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_batch_items" ADD CONSTRAINT "mail_batch_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_batch_oauth_handoffs" ADD CONSTRAINT "mail_batch_oauth_handoffs_batch_id_mail_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."mail_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_batch_oauth_handoffs" ADD CONSTRAINT "mail_batch_oauth_handoffs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_batches" ADD CONSTRAINT "mail_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_batches" ADD CONSTRAINT "mail_batches_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_batch_items_batch_cert_idx" ON "mail_batch_items" USING btree ("batch_id","certificate_id");--> statement-breakpoint
CREATE INDEX "mail_batch_items_claim_idx" ON "mail_batch_items" USING btree ("batch_id","status","next_attempt_at","recipient_order");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_batch_oauth_handoffs_state_idx" ON "mail_batch_oauth_handoffs" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX "mail_batch_oauth_handoffs_batch_idx" ON "mail_batch_oauth_handoffs" USING btree ("batch_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "mail_batches_user_event_idx" ON "mail_batches" USING btree ("user_id","event_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "mail_batches_queue_idx" ON "mail_batches" USING btree ("status","next_attempt_at","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_batches_active_event_idx" ON "mail_batches" USING btree ("event_id") WHERE "mail_batches"."status" in ('awaiting_auth', 'queued', 'running', 'paused_auth', 'paused_rate_limit', 'cancelling');