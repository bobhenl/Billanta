import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { customSlugSchema } from "../../public-links/public-link";

export class PortalSlugDto extends createZodDto(z.object({ slug: customSlugSchema })) {}
