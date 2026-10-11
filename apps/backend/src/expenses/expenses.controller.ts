import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { CreateExpenseDto } from "./dto/create-expense.dto";
import { ListExpensesQueryDto } from "./dto/list-expenses-query.dto";
import { UpdateExpenseDto } from "./dto/update-expense.dto";
import { ExpensesService } from "./expenses.service";

@ApiTags("expenses")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("v1/expenses")
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Get()
  @ApiOperation({ summary: "List expenses for the current tenant (paginated)" })
  list(@Req() req: TenantScopedRequest, @Query() query: ListExpensesQueryDto) {
    return this.expensesService.list(req.tenantDb!, query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get an expense by id" })
  findOne(@Req() req: TenantScopedRequest, @Param("id") id: string) {
    return this.expensesService.findOne(req.tenantDb!, id);
  }

  @Post()
  @ApiOperation({ summary: "Record an expense (incoming invoice/cost)" })
  create(@Req() req: TenantScopedRequest, @Body() dto: CreateExpenseDto) {
    return this.expensesService.create(req.tenantDb!, req.user!.tenantId, dto);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update an expense" })
  update(@Req() req: TenantScopedRequest, @Param("id") id: string, @Body() dto: UpdateExpenseDto) {
    return this.expensesService.update(req.tenantDb!, id, dto);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete an expense" })
  remove(@Req() req: TenantScopedRequest, @Param("id") id: string) {
    return this.expensesService.remove(req.tenantDb!, id);
  }
}
