import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const money = z.coerce.number().min(0).max(1_000_000);

export const projectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  contact_id: z.string().uuid().nullish(),
  hourly_rate: money.nullish(),
  currency: z.string().length(3).default("CZK"),
  color: z.string().trim().max(16).nullish(),
  archived: z.boolean().optional(),
});
export class CreateProjectDto extends createZodDto(projectSchema) {}
export class UpdateProjectDto extends createZodDto(projectSchema.partial()) {}

const entryFields = {
  description: z.string().trim().max(500).default(""),
  project_id: z.string().uuid().nullish(),
  contact_id: z.string().uuid().nullish(),
  hourly_rate: money.nullish(),
  billable: z.boolean().default(true),
};

/** A finished block of work typed in by hand: start + minutes (or end). */
export const timeEntrySchema = z
  .object({
    ...entryFields,
    started_at: z.coerce.date(),
    ended_at: z.coerce.date().nullish(),
    minutes: z.coerce.number().int().min(1).max(100_000).nullish(),
  })
  .refine((v) => v.minutes || (v.ended_at && v.ended_at > v.started_at), "Give minutes or an end after the start");
export class CreateTimeEntryDto extends createZodDto(timeEntrySchema) {}

export const updateTimeEntrySchema = z.object({
  ...entryFields,
  description: entryFields.description.optional(),
  billable: z.boolean().optional(),
  started_at: z.coerce.date().optional(),
  minutes: z.coerce.number().int().min(0).max(100_000).optional(),
});
export class UpdateTimeEntryDto extends createZodDto(updateTimeEntrySchema) {}

export const startTimerSchema = z.object({
  description: entryFields.description,
  project_id: entryFields.project_id,
  contact_id: entryFields.contact_id,
  billable: entryFields.billable,
});
export class StartTimerDto extends createZodDto(startTimerSchema) {}

export const listTimeEntriesSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  project_id: z.string().uuid().optional(),
  contact_id: z.string().uuid().optional(),
  // "unbilled" = billable and not on an invoice yet.
  state: z.enum(["all", "unbilled", "billed", "nonbillable"]).default("all"),
});
export class ListTimeEntriesQuery extends createZodDto(listTimeEntriesSchema) {}

export const invoiceTimeSchema = z.object({
  entry_ids: z.array(z.string().uuid()).min(1).max(500),
  // One line per entry, per project, or per day.
  group_by: z.enum(["entry", "project", "day"]).default("project"),
  // Needed when the entries have no customer of their own.
  contact_id: z.string().uuid().nullish(),
});
export class InvoiceTimeDto extends createZodDto(invoiceTimeSchema) {}
