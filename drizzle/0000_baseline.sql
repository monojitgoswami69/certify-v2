CREATE TABLE "certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid,
	"token_hash" text NOT NULL,
	"event_name" text,
	"record_fingerprint" text,
	"recipient_name" text NOT NULL,
	"recipient_email" text,
	"template_name" text,
	"status" text DEFAULT 'issued' NOT NULL,
	"row_data" jsonb,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_credentials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"expiry_date" integer,
	"scope" text,
	"token_type" text,
	"email" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registration_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"row_count" integer NOT NULL,
	"inserted_count" integer DEFAULT 0 NOT NULL,
	"reused_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"image_data" text NOT NULL,
	"image_hash" text,
	"width" integer,
	"height" integer,
	"layout_config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"issued_by_name" text,
	"picture" text,
	"role" text DEFAULT 'user' NOT NULL,
	"sessions_valid_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_credentials" ADD CONSTRAINT "google_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_batches" ADD CONSTRAINT "registration_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_batches" ADD CONSTRAINT "registration_batches_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_token_hash_idx" ON "certificates" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_user_fingerprint_idx" ON "certificates" USING btree ("user_id","record_fingerprint");--> statement-breakpoint
CREATE INDEX "certificates_user_id_idx" ON "certificates" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "certificates_event_id_idx" ON "certificates" USING btree ("user_id","event_id");--> statement-breakpoint
CREATE INDEX "certificates_event_name_idx" ON "certificates" USING btree ("event_name");--> statement-breakpoint
CREATE INDEX "certificates_issued_at_idx" ON "certificates" USING btree ("issued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "events_user_name_idx" ON "events" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "events_user_id_idx" ON "events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "registration_batches_event_idx" ON "registration_batches" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "templates_user_name_idx" ON "templates" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "templates_user_id_idx" ON "templates" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");