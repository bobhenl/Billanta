import { ConflictException, HttpException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { and, count, desc, eq, isNull, lt } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { channelLinks } from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import type { ActivateChannelLinkDto } from "./dto/activate-channel-link.dto";
import type { CreateLinkingTokenDto } from "./dto/create-linking-token.dto";
import type { VerifyChannelLinkDto } from "./dto/verify-channel-link.dto";

/** How long a code from Settings → Kanály stays valid. */
export const LINKING_TOKEN_TTL_MS = 30 * 60 * 1000;
const MAX_PENDING_TOKENS = 5;

@Injectable()
export class ChannelLinksService {
  constructor(private readonly dbService: DbService) {}

  /**
   * Resolves `(channel, external_user_id)` -> `tenant_id` for the AI
   * microservice's per-message tenant lookup (blueprint §6 step 2).
   *
   * ============================================================================
   * WHY THIS GOES THROUGH THE SHARED POOL (`DbService.db`), NOT `req.tenantDb`
   * — READ BEFORE "FIXING" THIS.
   * ============================================================================
   * Every other tenant-scoped table in this app is read exclusively through
   * `req.tenantDb`, the RLS-scoped connection `TenantContextMiddleware`
   * attaches per-request (see that file's big comment). `channel_links` is a
   * deliberate exception: it carries NO Row-Level Security policy at all
   * (see the "Deliberately EXCLUDED" section of `drizzle/rls-policies.sql`),
   * because its entire purpose is to answer exactly the question RLS would
   * otherwise block — "which tenant does this not-yet-authenticated external
   * sender belong to?" — before any tenant context exists to scope a
   * connection with. A tenant-id-keyed RLS policy on this table would make
   * the lookup that's supposed to *discover* the tenant id require already
   * knowing it: a chicken-and-egg deadlock, not real security.
   *
   * `channel_links`'s real security boundary is NOT row-level tenant
   * isolation, it's:
   *   - the `linking_token` used to *establish* a row in the first place
   *     (minted below, single-use in intent, meant to be short-lived once an
   *     activation step consumes it — see `createLinkingToken`'s comment);
   *   - `external_user_id` being a platform-issued id (Telegram/WhatsApp
   *     user id) that's unguessable in practice, combined with the unique
   *     index on `(channel, external_user_id)` in `drizzle/schema.ts`, which
   *     guarantees at most one tenant is ever behind a given sender.
   *
   * This is the ONE place in the backend that legitimately reads across
   * tenants by design — do not "fix" it by routing it through `req.tenantDb`.
   * `ChannelLinksController` is deliberately excluded from
   * `TenantContextMiddleware` in `AppModule.configure` for exactly this
   * reason, so `req.tenantDb` would never even be populated here.
   */
  async verify(dto: VerifyChannelLinkDto): Promise<{ tenantId: string }> {
    const [link] = await this.dbService.db
      .select({ tenantId: channelLinks.tenantId, isActive: channelLinks.isActive })
      .from(channelLinks)
      .where(
        and(
          eq(channelLinks.channel, dto.channel),
          eq(channelLinks.externalUserId, dto.external_user_id),
        ),
      )
      .limit(1);

    if (!link || !link.isActive) {
      // `resolve_tenant()` in apps/ai-service treats 404 as "unlinked
      // sender" and stops processing before ever touching invoice data —
      // see the controller's `@ApiOperation` description.
      throw new NotFoundException("No active channel link for this sender");
    }

    return { tenantId: link.tenantId };
  }

  /** Active links shown in Settings → Kanály. Never returns tokens. */
  async list(tenantId: string) {
    return this.dbService.db
      .select({
        id: channelLinks.id,
        channel: channelLinks.channel,
        externalUserId: channelLinks.externalUserId,
        displayName: channelLinks.externalDisplayName,
        linkedAt: channelLinks.updatedAt,
      })
      .from(channelLinks)
      .where(and(eq(channelLinks.tenantId, tenantId), eq(channelLinks.isActive, true)))
      .orderBy(desc(channelLinks.updatedAt));
  }

  /**
   * Mints a single-use linking token for the AUTHENTICATED tenant (`tenantId`
   * comes from `TenantContextMiddleware`, never the body — `channel_links` has
   * no RLS backstop). The row stays inactive until `activate()` consumes it.
   * Tokens expire after `LINKING_TOKEN_TTL_MS`; expired pending rows are swept
   * here, and at most `MAX_PENDING_TOKENS` may be pending per company.
   */
  async createLinkingToken(tenantId: string, dto: CreateLinkingTokenDto) {
    const db = this.dbService.db;
    const cutoff = new Date(Date.now() - LINKING_TOKEN_TTL_MS);
    await db
      .delete(channelLinks)
      .where(and(eq(channelLinks.isActive, false), isNull(channelLinks.externalUserId), lt(channelLinks.createdAt, cutoff)));

    const [{ pending }] = await db
      .select({ pending: count() })
      .from(channelLinks)
      .where(and(eq(channelLinks.tenantId, tenantId), eq(channelLinks.isActive, false), isNull(channelLinks.externalUserId)));
    if (pending >= MAX_PENDING_TOKENS) {
      throw new HttpException("Too many pending linking codes, try again later", HttpStatus.TOO_MANY_REQUESTS);
    }

    const linkingToken = randomBytes(24).toString("base64url");
    const [row] = await db
      .insert(channelLinks)
      .values({ tenantId, channel: dto.channel, linkingToken, isActive: false })
      .returning({ id: channelLinks.id, channel: channelLinks.channel, linkingToken: channelLinks.linkingToken, createdAt: channelLinks.createdAt });

    return {
      id: row.id,
      channel: row.channel,
      linkingToken: row.linkingToken,
      expiresAt: new Date(row.createdAt.getTime() + LINKING_TOKEN_TTL_MS).toISOString(),
    };
  }

  /**
   * Consumes a linking token the sender passed to the bot (`/start <token>`).
   * The token must match the channel, be pending and unexpired; it is cleared
   * on success so it can't be replayed. A sender already linked to ANOTHER
   * company gets a 409 (one sender, one company — the unique index); linking
   * again to the same company just drops the pending row.
   */
  async activate(dto: ActivateChannelLinkDto): Promise<{ tenantId: string; alreadyLinked: boolean }> {
    const db = this.dbService.db;
    const [pending] = await db
      .select({ id: channelLinks.id, tenantId: channelLinks.tenantId, createdAt: channelLinks.createdAt })
      .from(channelLinks)
      .where(
        and(
          eq(channelLinks.linkingToken, dto.linking_token),
          eq(channelLinks.channel, dto.channel),
          eq(channelLinks.isActive, false),
          isNull(channelLinks.externalUserId),
        ),
      )
      .limit(1);
    if (!pending || pending.createdAt.getTime() + LINKING_TOKEN_TTL_MS < Date.now()) {
      throw new NotFoundException("Linking code is invalid or expired");
    }

    const [existing] = await db
      .select({ id: channelLinks.id, tenantId: channelLinks.tenantId })
      .from(channelLinks)
      .where(and(eq(channelLinks.channel, dto.channel), eq(channelLinks.externalUserId, dto.external_user_id)))
      .limit(1);
    if (existing && existing.tenantId !== pending.tenantId) {
      throw new ConflictException("This account is already linked to another company");
    }
    if (existing) {
      await db.delete(channelLinks).where(eq(channelLinks.id, pending.id));
      await db
        .update(channelLinks)
        .set({ isActive: true, externalDisplayName: dto.display_name ?? null, updatedAt: new Date() })
        .where(eq(channelLinks.id, existing.id));
      return { tenantId: pending.tenantId, alreadyLinked: true };
    }

    const updated = await db
      .update(channelLinks)
      .set({
        externalUserId: dto.external_user_id,
        externalDisplayName: dto.display_name ?? null,
        isActive: true,
        linkingToken: null,
        updatedAt: new Date(),
      })
      // Re-check the token so two concurrent activations can't both win.
      .where(and(eq(channelLinks.id, pending.id), eq(channelLinks.linkingToken, dto.linking_token)))
      .returning({ id: channelLinks.id });
    if (updated.length === 0) throw new NotFoundException("Linking code is invalid or expired");
    return { tenantId: pending.tenantId, alreadyLinked: false };
  }

  /** Unlinks a chat; scoped to the caller's company. */
  async remove(tenantId: string, id: string): Promise<void> {
    const deleted = await this.dbService.db
      .delete(channelLinks)
      .where(and(eq(channelLinks.id, id), eq(channelLinks.tenantId, tenantId)))
      .returning({ id: channelLinks.id });
    if (deleted.length === 0) throw new NotFoundException("Channel link not found");
  }
}
