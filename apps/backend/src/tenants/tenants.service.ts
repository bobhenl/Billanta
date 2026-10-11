import { Injectable, NotImplementedException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";

type TenantDb = PostgresJsDatabase<typeof schema>;

@Injectable()
export class TenantsService {
  findById(db: TenantDb, id: string) {
    return db.select().from(schema.tenants).where(eq(schema.tenants.id, id)).limit(1);
  }

  update(): never {
    // TODO: implement tenant settings update (company info, default
    // locale, bank account, etc).
    throw new NotImplementedException();
  }

  signup(): never {
    // TODO: tenant signup happens BEFORE any tenant context exists — see
    // the bootstrap caveat in drizzle/rls-policies.sql on the `tenants`
    // table policy. Needs its own transactional bootstrap path (e.g. a
    // SECURITY DEFINER function, or a dedicated signup-only DB role) that
    // inserts the first tenant + owner tenant_membership + tos_acceptance
    // row together, since the normal request flow assumes tenant_id is
    // already known (blueprint §4, §9 signup gate).
    throw new NotImplementedException();
  }
}
