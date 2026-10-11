DO $$ BEGIN
 CREATE TYPE "public"."ai_mode" AS ENUM('off', 'platform', 'own');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "ai_mode" "ai_mode" DEFAULT 'platform' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "ai_api_key_encrypted" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "ai_api_key_last4" varchar(4);