import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const starContactSchema = z.object({ starred: z.boolean() });

export class StarContactDto extends createZodDto(starContactSchema) {}
