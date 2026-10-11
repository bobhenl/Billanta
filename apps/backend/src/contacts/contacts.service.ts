import { Injectable, NotImplementedException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import type { CreateContactDto } from "./dto/create-contact.dto";

// TODO: once packages/cz-compliance is ready:
// import { lookupIco } from "@faktur/cz-compliance";

type TenantDb = PostgresJsDatabase<typeof schema>;

@Injectable()
export class ContactsService {
  list(db: TenantDb) {
    // RLS on `contacts` already restricts this to the current tenant.
    return db.select().from(schema.contacts);
  }

  findOne(db: TenantDb, id: string) {
    return db.select().from(schema.contacts).where(eq(schema.contacts.id, id)).limit(1);
  }

  create(db: TenantDb, tenantId: string, dto: CreateContactDto) {
    // tenantId is taken from the verified request context (req.user.tenantId
    // via the controller), never from client-supplied input — the DTO
    // deliberately has no tenantId field.
    return db
      .insert(schema.contacts)
      .values({ tenantId, legalName: dto.legalName, ico: dto.ico, dic: dto.dic, email: dto.email })
      .returning();
  }

  update(): never {
    // TODO: implement update + ARES re-verification trigger.
    throw new NotImplementedException();
  }

  remove(): never {
    throw new NotImplementedException();
  }

  /**
   * TODO: not yet implemented. `apps/ai-service`'s
   * `enrich_with_ares()` (app/pipeline/voice_to_invoice.py) already calls
   * out to an *implied* endpoint at this exact path —
   * `POST /api/v1/contacts/ares-lookup` — via httpx, expecting it to
   * resolve/verify a counterparty against the ARES registry through
   * `packages/cz-compliance`'s cached client (blueprint §6 step 7) and
   * return something mappable to its `AresEnrichment` model. Its own code
   * comment explicitly says the backend owns this, not the AI service.
   * Implement once `@faktur/cz-compliance`'s ARES client exists.
   */
  aresLookup(): never {
    throw new NotImplementedException(
      "contacts ares-lookup: awaiting @faktur/cz-compliance's ARES client (blueprint §6 step 7); " +
        "apps/ai-service already expects to call this endpoint, see its enrich_with_ares() docstring",
    );
  }
}
