import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { BankRulesService } from "./bank-rules.service";
import { BankRuleDto, ReorderBankRulesDto, UpdateBankRuleDto } from "./dto/bank-rule.dto";

/**
 * Bank rules. Under `v1/bank-reconciliation`, so RoleAccessGuard puts them in
 * the "bank" area: members with read access list them, every POST/PATCH/DELETE
 * (preview included) needs write access.
 */
@ApiTags("bank-reconciliation")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("v1/bank-reconciliation/rules")
export class BankRulesController {
  constructor(private readonly rules: BankRulesService) {}

  @Get()
  @ApiOperation({ summary: "List bank rules in the order they run" })
  list(@Req() req: TenantScopedRequest) {
    return this.rules.list(req.tenantDb!);
  }

  @Post()
  @ApiOperation({ summary: "Create a bank rule (added last)" })
  create(@Req() req: TenantScopedRequest, @Body() dto: BankRuleDto) {
    return this.rules.create(req.tenantDb!, req.user!.tenantId, dto);
  }

  @Post("reorder")
  @ApiOperation({ summary: "Set the order of the rules: ids first to last" })
  reorder(@Req() req: TenantScopedRequest, @Body() dto: ReorderBankRulesDto) {
    return this.rules.reorder(req.tenantDb!, dto.ids);
  }

  @Post("preview")
  @ApiOperation({ summary: "Unmatched payments an unsaved rule would act on (no writes)" })
  preview(@Req() req: TenantScopedRequest, @Body() dto: BankRuleDto) {
    return this.rules.preview(req.tenantDb!, dto);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Change a bank rule" })
  update(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateBankRuleDto) {
    return this.rules.update(req.tenantDb!, id, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a bank rule; payments it acted on keep their state" })
  async remove(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    await this.rules.remove(req.tenantDb!, id);
  }

  @Post(":id/preview")
  @ApiOperation({ summary: "Unmatched payments a saved rule would act on (no writes)" })
  previewSaved(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.rules.previewSaved(req.tenantDb!, id);
  }

  @Post(":id/apply")
  @ApiOperation({ summary: "Apply a rule to the payments that are unmatched now (after one more auto-match)" })
  apply(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.rules.apply(req.tenantDb!, req.user!.tenantId, id);
  }
}
