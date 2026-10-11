import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const blank = z.literal("").transform(() => null);

export const bankAccountSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    account_number: z
      .string()
      .trim()
      .regex(/^(\d{1,6}-)?\d{2,10}$/)
      .nullish()
      .or(blank),
    bank_code: z
      .string()
      .trim()
      .regex(/^\d{4}$/)
      .nullish()
      .or(blank),
    iban: z
      .string()
      .transform((v) => v.replace(/\s+/g, "").toUpperCase())
      .pipe(z.string().regex(/^([A-Z]{2}\d{2}[A-Z0-9]{10,30})?$/))
      .transform((v) => v || null)
      .nullish(),
    swift: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^([A-Z0-9]{8}|[A-Z0-9]{11})?$/)
      .transform((v) => v || null)
      .nullish(),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^([A-Z]{3})?$/)
      .transform((v) => v || null)
      .nullish(),
    sort_order: z.coerce.number().int().min(0).max(1000).optional(),
  })
  .refine((v) => Boolean(v.iban) || Boolean(v.account_number && v.bank_code), {
    message: "Fill in either an IBAN or an account number with a bank code",
  });

export class BankAccountDto extends createZodDto(bankAccountSchema) {}
