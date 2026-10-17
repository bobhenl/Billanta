import { createZodDto } from "nestjs-zod";
import { partnerSchema } from "../partners.service";

export class CreatePartnerDto extends createZodDto(partnerSchema) {}
export class UpdatePartnerDto extends createZodDto(partnerSchema.partial()) {}
