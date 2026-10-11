import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CombinedAuthGuard } from "../auth/combined-auth.guard";
import { RequireActiveSubscription } from "../billing/require-active-subscription.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import {
  CreateProjectDto,
  CreateTimeEntryDto,
  InvoiceTimeDto,
  ListTimeEntriesQuery,
  StartTimerDto,
  UpdateProjectDto,
  UpdateTimeEntryDto,
} from "./dto/time-tracking.dto";
import { TimeTrackingService } from "./time-tracking.service";

/** API keys act as `service`, not a person: their entries have no user. */
const personOf = (req: TenantScopedRequest) => (req.user!.role === "service" ? null : req.user!.id);

/** Time tracking: projects, timer, entries, invoicing unbilled hours. */
@ApiTags("time-tracking")
@ApiBearerAuth()
@UseGuards(CombinedAuthGuard)
@Controller("v1")
export class TimeTrackingController {
  constructor(private readonly service: TimeTrackingService) {}

  @Get("projects")
  @ApiOperation({ summary: "Projects with unbilled and total minutes" })
  listProjects(@Req() req: TenantScopedRequest) {
    return this.service.listProjects(req.tenantDb!);
  }

  @Post("projects")
  @ApiOperation({ summary: "Create a project (name, contact_id?, hourly_rate?, currency)" })
  createProject(@Req() req: TenantScopedRequest, @Body() dto: CreateProjectDto) {
    return this.service.createProject(req.tenantDb!, req.user!.tenantId, dto);
  }

  @Patch("projects/:id")
  @ApiOperation({ summary: "Edit or archive a project" })
  updateProject(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateProjectDto) {
    return this.service.updateProject(req.tenantDb!, id, dto);
  }

  @Delete("projects/:id")
  @ApiOperation({ summary: "Delete a project (its entries stay, without a project)" })
  removeProject(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.service.removeProject(req.tenantDb!, id);
  }

  @Get("time-entries")
  @ApiOperation({ summary: "Finished entries (from, to, project_id, contact_id, state=all|unbilled|billed|nonbillable)" })
  list(@Req() req: TenantScopedRequest, @Query() query: ListTimeEntriesQuery) {
    return this.service.list(req.tenantDb!, query);
  }

  @Get("time-entries/summary")
  @ApiOperation({ summary: "This week's minutes, unbilled minutes and amounts, the running timer" })
  summary(@Req() req: TenantScopedRequest) {
    return this.service.summary(req.tenantDb!, personOf(req));
  }

  @Post("time-entries")
  @ApiOperation({ summary: "Add a block of work (started_at + minutes or ended_at)" })
  create(@Req() req: TenantScopedRequest, @Body() dto: CreateTimeEntryDto) {
    return this.service.create(req.tenantDb!, req.user!.tenantId, personOf(req), dto);
  }

  @Post("time-entries/start")
  @ApiOperation({ summary: "Start the timer (stops your running one first)" })
  start(@Req() req: TenantScopedRequest, @Body() dto: StartTimerDto) {
    return this.service.start(req.tenantDb!, req.user!.tenantId, personOf(req), dto);
  }

  @Post("time-entries/invoice")
  @RequireActiveSubscription()
  @ApiOperation({ summary: "Draft invoice from unbilled entries (entry_ids, group_by=entry|project|day, contact_id?)" })
  invoice(@Req() req: TenantScopedRequest, @Body() dto: InvoiceTimeDto) {
    return this.service.invoice(req.tenantDb!, req.user!.tenantId, dto);
  }

  @Post("time-entries/:id/stop")
  @ApiOperation({ summary: "Stop a running timer" })
  stop(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.service.stop(req.tenantDb!, id);
  }

  @Patch("time-entries/:id")
  @ApiOperation({ summary: "Edit an entry that is not invoiced yet" })
  update(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateTimeEntryDto) {
    return this.service.update(req.tenantDb!, id, dto);
  }

  @Delete("time-entries/:id")
  @ApiOperation({ summary: "Delete an entry that is not invoiced yet" })
  remove(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.service.remove(req.tenantDb!, id);
  }
}
