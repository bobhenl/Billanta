import { Body, Controller, Delete, ForbiddenException, Get, Post, Req, UseGuards } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import * as schema from "../../drizzle/schema";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { DbService } from "../db/db.service";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { AccountDeletionService } from "./account-deletion.service";
import { CreateTenantDto } from "./dto/create-tenant.dto";
import { MeService } from "./me.service";

/**
 * `GET /api/v1/me` — resolves "who is this JWT, and which tenant(s) can
 * they act as" for the frontend (`apps/frontend/lib/api-client.ts`), which
 * has no other way to discover a `tenant_memberships` row: it only has
 * direct DB access to the Auth.js-adapter tables (`users`/`accounts`/
 * `sessions`/`verification_tokens`, see `apps/frontend/lib/db.ts`), never
 * any tenant-owned table.
 *
 * Deliberately JWT-ONLY (`JwtAuthGuard`, NOT registered on
 * `AppModule.configure()`'s `TenantContextMiddleware.forRoutes(...)` list):
 * this endpoint's whole job is figuring out which tenant to use in the
 * first place, so it structurally cannot require a resolved `X-Tenant-Id`
 * up front — same category of pre-tenant-context route as
 * `ChannelLinksController` and `TenantsController`'s `POST /` signup
 * endpoint (see that class's and `AppModule.configure()`'s doc comments).
 * Because only `JwtAuthGuard` runs here (no middleware in front of it),
 * `req.user` is only ever PARTIALLY populated (`id`/`email`, never
 * `tenantId`/`role` — see `JwtAuthGuard`'s doc comment) — which is exactly
 * fine, since resolving `tenantId` is this endpoint's job, not a
 * precondition for calling it.
 */
@ApiTags("me")
@ApiBearerAuth()
@Controller("v1/me")
export class MeController {
  constructor(
    private readonly meService: MeService,
    private readonly accountDeletion: AccountDeletionService,
    private readonly dbService: DbService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Get the current user's identity and tenant memberships",
    description:
      "Returns the verified JWT's user id/email plus every tenant the user belongs to " +
      "(id, company name, role) via list_tenant_memberships_for_user – never any other " +
      "tenants column. An empty tenants array is a valid response (e.g. a user created " +
      "before the signup bootstrap flow existed), not an error.",
  })
  async getMe(@Req() req: TenantScopedRequest) {
    const [tenants, [flags]] = await Promise.all([
      this.meService.listTenantMemberships(req.user!.id),
      // What the user ticked at sign-up (migration 0079). `users` has no
      // tenant, so the pool is the right connection, as in refuseDemoUser.
      this.dbService.db
        .select({ isTeacher: schema.users.isTeacher, managesClients: schema.users.managesClients })
        .from(schema.users)
        .where(eq(schema.users.id, req.user!.id))
        .limit(1),
    ]);
    return {
      userId: req.user!.id,
      email: req.user!.email,
      isTeacher: flags?.isTeacher === true,
      managesClients: flags?.managesClients === true,
      tenants,
    };
  }

  /** Founds another company owned by the signed-in user (no X-Tenant-Id needed). */
  @Post("tenants")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Create another company (tenant) owned by the current user" })
  async createTenant(@Req() req: TenantScopedRequest, @Body() dto: CreateTenantDto) {
    await this.refuseDemoUser(req.user!.id);
    return this.meService.createTenant(req.user!.id, dto.companyName, dto.tosVersion, req.ip ?? null);
  }

  /**
   * Step 1 of "delete my account": removes everything tenant-side (see
   * `AccountDeletionService`). The frontend then deletes the Auth.js `users`
   * row itself. 409 `last_admin` / `issued_in_shared` = nothing was touched.
   */
  @Delete()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Delete the current user's tenant-side data (wipe sole-member companies, leave shared ones)" })
  async deleteMe(@Req() req: TenantScopedRequest) {
    await this.refuseDemoUser(req.user!.id);
    return this.accountDeletion.deleteAccountData(req.user!.id);
  }

  /**
   * A demo visitor owns exactly the one demo company, which the cleanup job
   * deletes. Read through the pool: `users` has no tenant and this route has
   * no tenant context.
   */
  private async refuseDemoUser(userId: string) {
    const [user] = await this.dbService.db.select({ isDemo: schema.users.isDemo }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    if (user?.isDemo) throw new ForbiddenException("demo_disabled");
  }
}
