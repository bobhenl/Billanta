import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { DemoSeedService } from "../demo/demo-seed.service";
import { EmailModule } from "../email/email.module";
import { InvoicesModule } from "../invoices/invoices.module";
import { PlatformAdminGuard } from "../partners/platform-admin.guard";
import { AdminClassroomController } from "./admin-classroom.controller";
import { ClassroomAdminService } from "./classroom-admin.service";
import { ClassroomClassesService } from "./classroom-classes.service";
import { ClassroomGroupsService } from "./classroom-groups.service";
import { ClassroomStudentController } from "./classroom-student.controller";
import { ClassroomTeachersService } from "./classroom-teachers.service";
import { ClassroomController } from "./classroom.controller";
import { ClassroomCron } from "./classroom.cron";
import { ClassroomJoinHandler } from "./join-kind";
import { PublicClassroomController } from "./public-classroom.controller";

/** Classroom mode (docs/classroom-mode-plan.md). Only ClassroomStudentController is tenant-scoped. */
@Module({
  // The seeder fills a student's company like a demo one; it needs the invoice and contact services.
  imports: [InvoicesModule, ContactsModule, EmailModule],
  controllers: [ClassroomController, ClassroomStudentController, PublicClassroomController, AdminClassroomController],
  providers: [ClassroomTeachersService, ClassroomClassesService, ClassroomGroupsService, ClassroomAdminService, ClassroomJoinHandler, DemoSeedService, PlatformAdminGuard, ClassroomCron],
})
export class ClassroomModule {}
