import { Module } from "@nestjs/common";
import { EmailModule } from "../email/email.module";
import { InvitationsController } from "./invitations.controller";
import { TeamController } from "./team.controller";
import { TeamService } from "./team.service";

@Module({
  imports: [EmailModule],
  controllers: [TeamController, InvitationsController],
  providers: [TeamService],
})
export class TeamModule {}
