import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const createBankConnectionSchema = z.object({
  provider: z.literal("fio").default("fio"),
  token: z.string().min(1).max(200),
  label: z.string().trim().max(80).nullish().transform((v) => v || null),
});

export class CreateBankConnectionDto extends createZodDto(createBankConnectionSchema) {}

export const updateBankConnectionSchema = z.object({
  enabled: z.boolean().optional(),
  label: z.string().trim().max(80).nullish().transform((v) => (v === undefined ? undefined : v || null)),
});

export class UpdateBankConnectionDto extends createZodDto(updateBankConnectionSchema) {}

export const startPsd2Schema = z.object({
  bankName: z.string().trim().min(1).max(200),
  country: z.string().trim().length(2).transform((v) => v.toUpperCase()),
  psuType: z.enum(["business", "personal"]).default("business"),
  label: z.string().trim().max(80).nullish().transform((v) => v || null),
  reconnectId: z.string().uuid().optional(),
});

export class StartPsd2Dto extends createZodDto(startPsd2Schema) {}

export const createPaypalSchema = z.object({
  clientId: z.string().trim().min(10).max(200),
  secret: z.string().trim().min(10).max(200),
  sandbox: z.boolean().default(false),
  label: z.string().trim().max(80).nullish().transform((v) => v || null),
});

export class CreatePaypalDto extends createZodDto(createPaypalSchema) {}

export const completePsd2Schema = z.object({
  code: z.string().min(1).max(2000),
  state: z.string().regex(/^[a-f0-9]{48}$/),
});

export class CompletePsd2Dto extends createZodDto(completePsd2Schema) {}
