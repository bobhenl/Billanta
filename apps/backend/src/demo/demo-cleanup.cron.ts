import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DemoService } from "./demo.service";

/**
 * Deletes expired demo companies every 15 minutes, and once at start-up so
 * a backend that was down for a day catches up. Logs counts only.
 */
@Injectable()
export class DemoCleanupCron implements OnApplicationBootstrap {
  private readonly logger = new Logger(DemoCleanupCron.name);
  private running = false;

  constructor(private readonly demo: DemoService) {}

  onApplicationBootstrap() {
    void this.run();
  }

  @Cron("*/15 * * * *")
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    let removed = 0;
    let failed = 0;
    try {
      for (;;) {
        const batch = await this.demo.claimExpired(50);
        for (const tenantId of batch) {
          try {
            await this.demo.remove(tenantId);
            removed++;
          } catch (err) {
            failed++;
            this.logger.error(`demo cleanup failed: ${(err as Error).message}`);
          }
        }
        if (batch.length < 50) break;
      }
    } catch (err) {
      this.logger.error(`demo cleanup sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
    if (removed || failed) this.logger.log(`demo cleanup: ${removed} removed, ${failed} failed`);
  }
}
