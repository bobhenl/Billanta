import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Req, Res, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Response } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { ClassroomClassesService } from "./classroom-classes.service";
import { classroomConfig } from "./classroom-config";
import { ClassroomTeachersService } from "./classroom-teachers.service";
import { ApplyDto, CoTeacherDto, CreateClassDto, ExtendClassDto, InviteDto, UpdateClassDto } from "./classroom.dto";

/**
 * The teacher's side (docs/classroom-mode-plan.md). JWT only, no tenant
 * context: classes are not a company's data, and a teacher looks into the
 * students' companies through their viewer memberships, not from here.
 * The services refuse demo and student tokens.
 */
@ApiExcludeController()
@UseGuards(JwtAuthGuard)
@Controller("v1/classroom")
export class ClassroomController {
  constructor(
    private readonly teachers: ClassroomTeachersService,
    private readonly classes: ClassroomClassesService,
  ) {}

  @Get("me")
  me(@Req() req: TenantScopedRequest) {
    enabled();
    return this.teachers.status(req.user!.id);
  }

  @Post("apply")
  @HttpCode(200)
  apply(@Req() req: TenantScopedRequest, @Body() dto: ApplyDto) {
    enabled();
    return this.teachers.apply(req.user!.id, dto);
  }

  @Post("invites")
  @HttpCode(200)
  invite(@Req() req: TenantScopedRequest, @Body() dto: InviteDto) {
    enabled();
    return this.teachers.invite(req.user!.id, dto.email);
  }

  @Get("colleagues")
  colleagues(@Req() req: TenantScopedRequest) {
    enabled();
    return this.teachers.colleagues(req.user!.id);
  }

  @Get("classes")
  list(@Req() req: TenantScopedRequest) {
    enabled();
    return this.classes.list(req.user!.id);
  }

  @Post("classes")
  create(@Req() req: TenantScopedRequest, @Body() dto: CreateClassDto) {
    enabled();
    return this.classes.create(req.user!.id, dto);
  }

  @Get("classes/:id")
  get(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    enabled();
    return this.classes.get(req.user!.id, id);
  }

  @Get("classes/:id/progress.csv")
  async csv(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    enabled();
    const { name, csv } = await this.classes.progressCsv(req.user!.id, id);
    const file = `${name.replace(/[^\p{L}\p{N}._-]+/gu, "-") || "class"}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="class.csv"; filename*=UTF-8''${encodeURIComponent(file)}`);
    // The BOM makes Excel read the nicknames' diacritics as UTF-8.
    res.send(`﻿${csv}`);
  }

  @Patch("classes/:id")
  update(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateClassDto) {
    enabled();
    return this.classes.update(req.user!.id, id, dto);
  }

  @Post("classes/:id/join-code")
  @HttpCode(200)
  rotate(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    enabled();
    return this.classes.rotateJoinCode(req.user!.id, id);
  }

  @Post("classes/:id/extend")
  @HttpCode(200)
  extend(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ExtendClassDto) {
    enabled();
    return this.classes.extend(req.user!.id, id, dto);
  }

  @Post("classes/:id/teachers")
  @HttpCode(200)
  addTeacher(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string, @Body() dto: CoTeacherDto) {
    enabled();
    return this.classes.addCoTeacher(req.user!.id, id, dto.teacherId);
  }

  @Delete("classes/:id/teachers/:teacherId")
  removeTeacher(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string, @Param("teacherId", ParseUUIDPipe) teacherId: string) {
    enabled();
    return this.classes.removeCoTeacher(req.user!.id, id, teacherId);
  }

  @Post("classes/:id/students/:studentId/code")
  @HttpCode(200)
  newCode(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string, @Param("studentId", ParseUUIDPipe) studentId: string) {
    enabled();
    return this.classes.regenerateStudentCode(req.user!.id, id, studentId);
  }

  @Delete("classes/:id/students/:studentId")
  removeStudent(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string, @Param("studentId", ParseUUIDPipe) studentId: string) {
    enabled();
    return this.classes.removeStudent(req.user!.id, id, studentId);
  }

  @Delete("classes/:id")
  remove(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    enabled();
    return this.classes.remove(req.user!.id, id);
  }
}

/** Off: look like a route that doesn't exist, as the demo does. */
function enabled() {
  if (!classroomConfig().enabled) throw new NotFoundException();
}
