import { Controller, Get, Header } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { PublicProfilesService } from "./public-profiles.service";

/**
 * PUBLIC directory of accountants who opted in from their public profile.
 * Same rules as `PublicProfilesController`: no auth, reads only through the
 * `list_public_accountants` SECURITY DEFINER function. Its own path so the
 * word can never collide with a profile slug.
 */
@ApiTags("public-profiles")
@Controller("v1/public/accountants")
export class PublicAccountantsController {
  constructor(private readonly publicProfilesService: PublicProfilesService) {}

  @Get()
  @Header("Cache-Control", "public, max-age=300")
  @ApiOperation({
    summary: "Accountants listed in the public directory",
    description: "No authentication. Name, city, tagline and profile slug of accountants who chose to be listed.",
  })
  list() {
    return this.publicProfilesService.listAccountants();
  }
}
