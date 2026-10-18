import { Controller, Get, Header, Param, Res } from "@nestjs/common";
import type { Response } from "express";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { PublicProfilesService } from "./public-profiles.service";

/**
 * PUBLIC, unauthenticated company profile (Settings → Veřejný profil).
 * Like `PublicInvoicesController`: no `JwtAuthGuard`, not in
 * `TenantContextMiddleware.forRoutes(...)`, and every read goes through a
 * narrow SECURITY DEFINER function keyed on the slug. 404 for unknown,
 * malformed and unpublished slugs alike.
 */
@ApiTags("public-profiles")
@Controller("v1/public/profiles")
export class PublicProfilesController {
  constructor(private readonly publicProfilesService: PublicProfilesService) {}

  @Get(":slug")
  // A minute, like the frontend's fetch cache: the owner's edit shows soon.
  @Header("Cache-Control", "public, max-age=60, s-maxage=60, stale-while-revalidate=300")
  @ApiOperation({
    summary: "A company's published public profile",
    description: "No authentication. Returns only the fields the company chose to show; never bank details.",
  })
  findBySlug(@Param("slug") slug: string) {
    return this.publicProfilesService.findBySlug(slug);
  }

  @Get(":slug/logo")
  @ApiOperation({ summary: "The logo of a published profile (404 when hidden or missing)" })
  async logo(@Param("slug") slug: string, @Res() res: Response) {
    const logo = await this.publicProfilesService.logo(slug);
    res.setHeader("Content-Type", logo.mime);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(logo.data);
  }
}
