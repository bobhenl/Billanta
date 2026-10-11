import { Injectable, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { channelLinks } from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import type { CreateLinkingTokenDto } from "./dto/create-linking-token.dto";
import type { VerifyChannelLinkDto } from "./dto/verify-channel-link.dto";

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

  /**
   * Dashboard-user-initiated: mint a short-lived, single-use linking token
   * for the AUTHENTICATED tenant, to be embedded in a deep-link/code the
   * user sends to the bot to prove ownership of the external account
   * (blueprint §6 step 2). The row starts inactive (`is_active = false`,
   * `external_user_id = null`) until a later activation step matches an
   * inbound platform message carrying this token and flips `is_active` +
   * fills in `external_user_id`. That activation step is NOT implemented
   * anywhere yet (backend or ai-service — see the TODO in
   * `apps/ai-service/app/webhooks/telegram.py`); this method only covers
   * minting the token.
   *
   * `tenantId` MUST come from the verified JWT (`req.user.tenantId` in the
   * controller), never from the request body — since `channel_links` carries
   * no RLS policy (see `verify()`'s comment), there is no database-level
   * backstop against inserting a row under the wrong tenant; the
   * authenticated caller's own tenant id is the only thing enforcing that
   * here. This also runs through `DbService.db` rather than `req.tenantDb`
   * for the same reason `verify()` does — there is no RLS-scoped connection
   * to use, because there is no RLS on this table.
   */
  async createLinkingToken(tenantId: string, dto: CreateLinkingTokenDto) {
    const linkingToken = randomBytes(24).toString("base64url");

    const [row] = await this.dbService.db
      .insert(channelLinks)
      .values({ tenantId, channel: dto.channel, linkingToken, isActive: false })
      .returning({
        id: channelLinks.id,
        channel: channelLinks.channel,
        linkingToken: channelLinks.linkingToken,
      });

    return row;
  }
}
