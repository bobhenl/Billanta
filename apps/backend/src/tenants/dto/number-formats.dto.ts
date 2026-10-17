import { createZodDto } from "nestjs-zod";
import { numberFormatsInputSchema } from "../number-formats";

/** PUT /v1/tenants/me/number-formats – own number pattern and "next number" per document type. */
export class NumberFormatsDto extends createZodDto(numberFormatsInputSchema) {}
