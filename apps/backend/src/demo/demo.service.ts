import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { DbService } from "../db/db.service";
import { SUPPLIERS } from "./dataset/kinds";
import type { DemoKind } from "./dataset";
import { demoConfig } from "./demo-config";
import { DemoSeedService } from "./demo-seed.service";

export interface DemoStart {
  userId: string;
  tenantId: string;
  expiresAt: string;
}

/**
 * Starts and ends demo companies. Creation and deletion go through the
 * SECURITY DEFINER functions of migration 0068 (they write what the demo
 * triggers forbid `faktur_app`); the content goes in through RLS.
 */
@Injectable()
export class DemoService {
  private readonly logger = new Logger(DemoService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly seeder: DemoSeedService,
  ) {}

  async create(kind: DemoKind, ipBucket: string): Promise<DemoStart> {
    const cfg = demoConfig();
    const sup = SUPPLIERS[kind];
    let row: { tenant_id: string; user_id: string; expires_at: Date };
    try {
      [row] = await this.dbService.sql<{ tenant_id: string; user_id: string; expires_at: Date }[]>`
        SELECT * FROM create_demo_tenant(
          ${kind}, ${ipBucket}, ${cfg.ttlHours}, ${cfg.perIpDaily}, ${cfg.maxActive},
          ${JSON.stringify(sup.tenant)}::jsonb, ${JSON.stringify(sup.bank)}::jsonb
        )`;
    } catch (err) {
      const code = (err as Error).message;
      if (code === "demo_ip_limit") throw new HttpException("demo_ip_limit", HttpStatus.TOO_MANY_REQUESTS);
      if (code === "demo_capacity") throw new HttpException("demo_capacity", HttpStatus.SERVICE_UNAVAILABLE);
      throw err;
    }

    try {
      await this.seeder.seed(row.tenant_id, row.user_id, kind);
    } catch (err) {
      // A half-filled company is worse than none: drop it, the visitor retries.
      this.logger.error(`demo seed (${kind}) failed: ${(err as Error).message}`);
      await this.remove(row.tenant_id).catch(() => undefined);
      throw new HttpException("demo_unavailable", HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { userId: row.user_id, tenantId: row.tenant_id, expiresAt: new Date(row.expires_at).toISOString() };
  }

  async remove(tenantId: string): Promise<void> {
    await this.dbService.sql`SELECT delete_demo_tenant(${tenantId})`;
  }

  /** Expired demos to delete; a claim that dies is retried after 30 minutes. */
  async claimExpired(limit: number): Promise<string[]> {
    const rows = await this.dbService.sql<{ id: string }[]>`
      SELECT t AS id FROM claim_expired_demo_tenants(${limit}, interval '30 minutes') AS t`;
    return rows.map((r) => r.id);
  }
}
