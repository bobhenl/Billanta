import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  Param,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
  type RawBodyRequest,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { DbService } from "../db/db.service";
import { PlatformAdminGuard } from "../partners/platform-admin.guard";
import { EmailUnsubscribeService } from "./email-unsubscribe.service";
import { verifySvixSignature } from "./svix-signature";

/** Unsubscribe links from e-mail footers and `List-Unsubscribe` (no session; the token is the authority). */
@ApiTags("email")
@Controller("v1/public/email/unsubscribe")
export class EmailUnsubscribeController {
  constructor(private readonly unsubscribe: EmailUnsubscribeService) {}

  @Get(":token")
  @ApiOperation({ summary: "What an unsubscribe link would turn off (read-only)" })
  preview(@Param("token") token: string) {
    return this.unsubscribe.preview(token);
  }

  /** Both the page's confirm button and RFC 8058 one-click POSTs from mail clients land here. */
  @Post(":token")
  @HttpCode(200)
  @ApiOperation({ summary: "Turn the e-mail type off" })
  confirm(@Param("token") token: string) {
    return this.unsubscribe.unsubscribe(token);
  }
}

type ResendEvent = {
  type?: string;
  data?: { email_id?: string; to?: string[] | string; bounce?: { type?: string; subType?: string; message?: string } };
};

/**
 * Resend's delivery webhook (Svix-signed with `RESEND_WEBHOOK_SECRET`).
 * Hard bounces and spam complaints put the address on the suppression list,
 * so the outbox stops mailing it; soft bounces only get noted on the row.
 */
@ApiTags("email")
@Controller("v1/webhooks/resend")
export class ResendWebhookController {
  private readonly logger = new Logger(ResendWebhookController.name);

  constructor(private readonly dbService: DbService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: "Resend bounce/complaint/delivery events" })
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers("svix-id") id: string | undefined,
    @Headers("svix-timestamp") timestamp: string | undefined,
    @Headers("svix-signature") signature: string | undefined,
  ) {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) throw new ServiceUnavailableException("webhook_not_configured");
    const raw = req.rawBody?.toString("utf8") ?? "";
    const verdict = verifySvixSignature({ id, timestamp, signature }, raw, secret);
    if (!verdict.ok) throw new UnauthorizedException(verdict.reason);

    let event: ResendEvent;
    try {
      event = JSON.parse(raw) as ResendEvent;
    } catch {
      throw new BadRequestException("invalid_payload");
    }
    const mapped = mapResendEvent(event);
    if (!mapped) return { ok: true, ignored: event.type ?? null };
    for (const address of mapped.addresses) {
      await this.dbService.sql`SELECT record_email_event(${mapped.providerId}, ${mapped.event}, ${address}, ${mapped.detail})`;
    }
    if (!mapped.addresses.length) {
      await this.dbService.sql`SELECT record_email_event(${mapped.providerId}, ${mapped.event}, ${null}, ${mapped.detail})`;
    }
    if (mapped.event !== "delivered") this.logger.warn(`Resend ${event.type} for message ${mapped.providerId}`);
    return { ok: true };
  }
}

/**
 * Resend event → what `record_email_event` stores. A transient or
 * undetermined bounce is recorded on the outbox row as "soft" (no address),
 * so a full mailbox doesn't block the customer for good.
 */
export function mapResendEvent(event: ResendEvent) {
  const providerId = event.data?.email_id ?? null;
  const to = event.data?.to;
  const addresses = (Array.isArray(to) ? to : to ? [to] : []).map((a) => a.trim().toLowerCase()).filter(Boolean);
  switch (event.type) {
    case "email.delivered":
      return { event: "delivered" as const, providerId, addresses: [] as string[], detail: null };
    case "email.complained":
      return { event: "complained" as const, providerId, addresses, detail: "complaint" };
    case "email.bounced": {
      const b = event.data?.bounce;
      const detail = [b?.type, b?.subType, b?.message].filter(Boolean).join(": ").slice(0, 1000) || "bounce";
      const hard = b?.type === "Permanent";
      return { event: "bounced" as const, providerId, addresses: hard ? addresses : [], detail: hard ? detail : `soft: ${detail}` };
    }
    default:
      return null;
  }
}

/** Billanta staff: is mail going out, and what failed. Metadata only, never bodies. */
@ApiTags("admin-email")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller("v1/admin/email-outbox")
export class AdminEmailOutboxController {
  constructor(private readonly dbService: DbService) {}

  @Get()
  @ApiOperation({ summary: "Outbox counts per status and the latest rows (optionally one status)" })
  async overview(@Query("status") status?: string, @Query("limit") limit?: string) {
    const filter = status && /^[a-z_]{1,16}$/.test(status) ? status : null;
    const [stats, recent] = await Promise.all([
      this.dbService.sql`SELECT * FROM email_outbox_stats()`,
      this.dbService.sql`SELECT * FROM email_outbox_recent(${Math.min(Number(limit) || 50, 200)}, ${filter})`,
    ]);
    return { stats, recent };
  }
}
