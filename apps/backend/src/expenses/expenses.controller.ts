import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { MAX_ATTACHMENT_BYTES } from "../invoices/invoice-attachments.service";
import { SetAccessLockDto } from "../tenancy/access-lock.dto";
import { assertMayDo } from "../tenancy/permissions";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { encryptedLimit, type UploadedFileLike } from "../vault/sealed-files";
import { ExpenseAttachmentsService } from "./expense-attachments.service";
import { CreateExpenseDto } from "./dto/create-expense.dto";
import { ListExpensesQueryDto } from "./dto/list-expenses-query.dto";
import { UpdateExpenseDto } from "./dto/update-expense.dto";
import { ExpensesService } from "./expenses.service";

@ApiTags("expenses")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("v1/expenses")
export class ExpensesController {
  constructor(
    private readonly expensesService: ExpensesService,
    private readonly attachmentsService: ExpenseAttachmentsService,
  ) {}

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
    if (dto.paidAt) assertMayDo(req.user, "expenses.approve");
    return this.expensesService.create(req.tenantDb!, req.user!.tenantId, dto);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update an expense" })
  async update(@Req() req: TenantScopedRequest, @Param("id") id: string, @Body() dto: UpdateExpenseDto) {
    // The edit form sends the paid date with every save; only a change counts as approving the payment.
    if (dto.paidAt !== undefined) {
      const current = await this.expensesService.findOne(req.tenantDb!, id);
      if ((current.paidAt?.getTime() ?? null) !== (dto.paidAt?.getTime() ?? null)) assertMayDo(req.user, "expenses.approve");
    }
    return this.expensesService.update(req.tenantDb!, id, dto);
  }

  @Patch(":id/access-lock")
  @ApiOperation({
    summary: "Lock who sees an expense (level: private | admin | accountant | null)",
    description: "Same rules as PATCH /v1/invoices/:id/access-lock (403 visibility_owner_only). Audited.",
  })
  setAccessLock(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string, @Body() dto: SetAccessLockDto) {
    return this.expensesService.setAccessLock(req.tenantDb!, id, dto.level, req.user!);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete an expense" })
  remove(@Req() req: TenantScopedRequest, @Param("id") id: string) {
    assertMayDo(req.user, "expenses.delete");
    return this.expensesService.remove(req.tenantDb!, id);
  }

  @Get(":id/attachments")
  @ApiOperation({ summary: "List an expense's files (without contents)" })
  listAttachments(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.attachmentsService.list(req.tenantDb!, id);
  }

  @Post(":id/attachments")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: encryptedLimit(MAX_ATTACHMENT_BYTES) } }))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Attach a receipt or supplier invoice (≤ 5 MB), plain or encrypted in the browser" })
  addAttachment(
    @Req() req: TenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFile() file?: UploadedFileLike,
    @Body("enc_meta") encMeta?: unknown,
  ) {
    if (!file) throw new BadRequestException({ error: "no_file" });
    return this.attachmentsService.add(req.tenantDb!, req.user!.tenantId, id, file, encMeta);
  }

  @Delete(":id/attachments/:attachmentId")
  @ApiOperation({ summary: "Remove an expense file" })
  removeAttachment(
    @Req() req: TenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("attachmentId", ParseUUIDPipe) attachmentId: string,
  ) {
    return this.attachmentsService.remove(req.tenantDb!, id, attachmentId);
  }

  @Get(":id/attachments/:attachmentId")
  @ApiOperation({ summary: "Download an expense file (ciphertext when it was uploaded encrypted)" })
  async downloadAttachment(
    @Req() req: TenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("attachmentId", ParseUUIDPipe) attachmentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.attachmentsService.download(req.tenantDb!, id, attachmentId);
    res.set({
      "Content-Type": file.mime,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "X-Content-Type-Options": "nosniff",
    });
    res.send(file.content);
  }
}
