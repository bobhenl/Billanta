ALTER TABLE "tenant_memberships" ADD COLUMN "permissions" jsonb;--> statement-breakpoint
ALTER TABLE "tenant_invitations" ADD COLUMN "permissions" jsonb;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "enabled_modules" jsonb DEFAULT '{}'::jsonb NOT NULL;
