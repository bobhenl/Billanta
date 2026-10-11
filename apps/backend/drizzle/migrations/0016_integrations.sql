ALTER TABLE "tenant_memberships" ADD COLUMN "feed_token" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_memberships_feed_token_unique" ON "tenant_memberships" USING btree ("feed_token");--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "webhooks" jsonb DEFAULT '[]'::jsonb NOT NULL;
