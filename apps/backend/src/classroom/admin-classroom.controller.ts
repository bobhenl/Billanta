import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PlatformAdminGuard } from "../partners/platform-admin.guard";
import { ClassroomAdminService } from "./classroom-admin.service";
import { DecisionDto } from "./classroom.dto";

class SuspendDto extends createZodDto(z.object({ suspended: z.boolean(), note: z.string().trim().max(1000).optional() })) {}

/** Teacher applications and schools, for Billanta staff. */
@ApiExcludeController()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller("v1/admin/classroom")
export class AdminClassroomController {
  constructor(private readonly admin: ClassroomAdminService) {}

  @Get("teachers")
  teachers() {
    return this.admin.teachers();
  }

  @Post("teachers/:id/decision")
  @HttpCode(200)
  decide(@Param("id", ParseUUIDPipe) id: string, @Body() dto: DecisionDto) {
    return this.admin.decide(id, dto);
  }

  @Post("schools/:id/suspend")
  @HttpCode(200)
  suspend(@Param("id", ParseUUIDPipe) id: string, @Body() dto: SuspendDto) {
    return this.admin.suspend(id, dto.suspended, dto.note);
  }
}
