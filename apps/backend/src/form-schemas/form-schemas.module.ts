import { Module } from "@nestjs/common";
import { EmailModule } from "../email/email.module";
import { PlatformAdminGuard } from "../partners/platform-admin.guard";
import { AdminFormSchemasController } from "./admin-form-schemas.controller";
import { FormSchemasCron } from "./form-schemas.cron";
import { FormSchemasService } from "./form-schemas.service";

@Module({
  imports: [EmailModule],
  controllers: [AdminFormSchemasController],
  providers: [FormSchemasService, FormSchemasCron, PlatformAdminGuard],
  exports: [FormSchemasService],
})
export class FormSchemasModule {}
