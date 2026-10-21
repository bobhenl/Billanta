import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { BankReconciliationService } from "./bank-reconciliation.service";
import { ListBankTransactionsQueryDto } from "./dto/list-transactions-query.dto";
import { ManualMatchDto } from "./dto/manual-match.dto";
import { hasStatementExtension } from "./statement-upload";

/** Plenty for a monthly bank-statement CSV; guards against an accidental
 * (or hostile) huge upload being buffered entirely in memory — this module
 * deliberately never writes the upload to disk (see the controller doc
 * comment below), so the whole file lives in process memory until parsed. */
const MAX_CSV_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * `multer`'s `MemoryStorage` file shape (the subset this controller
 * actually reads). Deliberately a local structural type instead of the
 * global `Express.Multer.File` — that global is declared by the `@types/
 * multer` package, which isn't a dependency here; `@nestjs/platform-
 * express`'s own `MulterOptions`/`FileInterceptor` types (used below) don't
 * need it either, so avoiding it keeps this module dependency-free.
 */
interface UploadedCsvFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@ApiTags("bank-reconciliation")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("v1/bank-reconciliation")
export class BankReconciliationController {
  constructor(private readonly bankReconciliationService: BankReconciliationService) {}

  /**
   * Accepts a bank statement: CSV, camt.053 XML or GPC/ABO (.gpc, .abo).
   * See `apps/backend/README.md`'s "Bank reconciliation" section.
   * `FileInterceptor` uses multer's default `MemoryStorage` (no `storage`/
   * `dest` option configured), so the upload is held in `file.buffer` only
   * for the duration of this request and never written to disk or object
   * storage — only the parsed transaction rows are persisted.
   */
  @Post("import")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_CSV_SIZE_BYTES } }))
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: { file: { type: "string", format: "binary" } },
      required: ["file"],
    },
  })
  @ApiOperation({
    summary: "Import a bank statement (CSV, camt.053, GPC) and auto-match transactions against issued invoices",
  })
  async importStatement(@Req() req: TenantScopedRequest, @UploadedFile() file?: UploadedCsvFile) {
    if (!file) {
      throw new BadRequestException('No file uploaded – expected a multipart form field named "file"');
    }
    if (!hasStatementExtension(file.originalname)) {
      throw new BadRequestException("bank_statement_unknown_format");
    }

    return this.bankReconciliationService.importStatement(req.tenantDb!, req.user!.tenantId, file.originalname, file.buffer);
  }

  @Get("transactions")
  @ApiOperation({ summary: "List bank transactions for the current tenant, optionally filtered by status" })
  list(@Req() req: TenantScopedRequest, @Query() query: ListBankTransactionsQueryDto) {
    return this.bankReconciliationService.list(req.tenantDb!, query.status);
  }

  @Get("transactions/:id")
  @ApiOperation({ summary: "Get one bank transaction with its statement import" })
  findOne(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.bankReconciliationService.findOne(req.tenantDb!, id);
  }

  @Post("transactions/:id/restore")
  @ApiOperation({ summary: "Return an ignored bank transaction to the unmatched state" })
  restore(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.bankReconciliationService.restore(req.tenantDb!, id);
  }

  @Post("transactions/:id/match")
  @ApiOperation({ summary: "Manually link an unmatched bank transaction to a specific issued invoice" })
  manualMatch(@Req() req: TenantScopedRequest, @Param("id") id: string, @Body() dto: ManualMatchDto) {
    return this.bankReconciliationService.manualMatch(req.tenantDb!, req.user!.tenantId, id, dto.invoiceId);
  }

  @Post("transactions/:id/ignore")
  @ApiOperation({ summary: "Mark a bank transaction as ignored (not an invoice payment)" })
  ignore(@Req() req: TenantScopedRequest, @Param("id") id: string) {
    return this.bankReconciliationService.ignore(req.tenantDb!, id);
  }
}
