CREATE TABLE "certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"event_name" text,
	"record_fingerprint" text,
	"recipient_name" text NOT NULL,
	"recipient_email" text,
	"row_data" jsonb,
	"template_name" text,
	"status" text DEFAULT 'issued' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scan_count" integer DEFAULT 0 NOT NULL,
	"last_scanned_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "scan_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"certificate_id" uuid NOT NULL,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
ALTER TABLE "scan_events" ADD CONSTRAINT "scan_events_certificate_id_certificates_id_fk" FOREIGN KEY ("certificate_id") REFERENCES "public"."certificates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_token_hash_idx" ON "certificates" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "certificates_event_name_idx" ON "certificates" USING btree ("event_name");--> statement-breakpoint
CREATE INDEX "certificates_record_fingerprint_idx" ON "certificates" USING btree ("record_fingerprint");--> statement-breakpoint
CREATE INDEX "scan_events_certificate_id_idx" ON "scan_events" USING btree ("certificate_id");