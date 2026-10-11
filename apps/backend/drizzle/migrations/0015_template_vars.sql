ALTER TABLE "tenants" ADD COLUMN "template_vars" jsonb DEFAULT '[]'::jsonb NOT NULL;
