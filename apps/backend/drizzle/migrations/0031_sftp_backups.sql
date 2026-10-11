-- Backups to the company's own SFTP server, optionally age-encrypted.
ALTER TYPE "backup_destination_type" ADD VALUE IF NOT EXISTS 'sftp';--> statement-breakpoint
ALTER TABLE "backup_destinations" ADD COLUMN IF NOT EXISTS "sftp_host" text;--> statement-breakpoint
ALTER TABLE "backup_destinations" ADD COLUMN IF NOT EXISTS "sftp_port" integer;--> statement-breakpoint
ALTER TABLE "backup_destinations" ADD COLUMN IF NOT EXISTS "sftp_username" text;--> statement-breakpoint
ALTER TABLE "backup_destinations" ADD COLUMN IF NOT EXISTS "sftp_path" text;--> statement-breakpoint
ALTER TABLE "backup_destinations" ADD COLUMN IF NOT EXISTS "sftp_public_key" text;--> statement-breakpoint
ALTER TABLE "backup_destinations" ADD COLUMN IF NOT EXISTS "sftp_host_fingerprint" text;--> statement-breakpoint
ALTER TABLE "backup_destinations" ADD COLUMN IF NOT EXISTS "encryption_recipient" text;--> statement-breakpoint
ALTER TABLE "backup_destinations" ADD COLUMN IF NOT EXISTS "encryption_passphrase_encrypted" text;
