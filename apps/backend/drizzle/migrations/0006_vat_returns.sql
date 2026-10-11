ALTER TABLE "expenses" ADD COLUMN "supplier_dic" varchar(14);--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "exchange_rate" numeric(14, 6);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "exchange_rate" numeric(14, 6);