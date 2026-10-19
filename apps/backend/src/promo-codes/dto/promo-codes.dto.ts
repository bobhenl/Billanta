import { createZodDto } from "nestjs-zod";
import { promoCodeSchema, redeemPromoSchema, updatePromoCodeSchema } from "../promo-codes.service";

export class RedeemPromoDto extends createZodDto(redeemPromoSchema) {}
export class CreatePromoCodeDto extends createZodDto(promoCodeSchema) {}
export class UpdatePromoCodeDto extends createZodDto(updatePromoCodeSchema) {}
