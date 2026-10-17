import { NotFoundException } from "@nestjs/common";
import { lookupVies, parseVatId } from "@faktur/cz-compliance";
import type { ContactsService } from "../contacts/contacts.service";

/**
 * Company lookup for the public forms where a customer types their own
 * billing details (buyer-details link, profile orders): Czech/Slovak IČO
 * through ARES/RPO, or an EU VAT ID through VIES. Callers rate-limit it and
 * check that their link or profile is open first.
 */
export type RegistryQuery = { ico: string } | { vat: string };

export interface RegistryHit {
  name: string | null;
  ico: string | null;
  dic: string | null;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  country: string;
}

/** The query from `?ico=` / `?vat=`, or null when neither is a valid identifier. */
export function registryQueryOf(rawIco: string | undefined, rawVat: string | undefined): RegistryQuery | null {
  const ico = (rawIco ?? "").replace(/\s+/g, "");
  if (ico) return /^\d{6,8}$/.test(ico) ? { ico: ico.padStart(8, "0") } : null;
  const vat = (rawVat ?? "").replace(/[\s.-]/g, "").toUpperCase();
  return parseVatId(vat) ? { vat } : null;
}

/** 404 `not_found` for anything the registries don't know (or when they are down). */
export async function registryLookup(contacts: Pick<ContactsService, "aresLookup">, query: RegistryQuery): Promise<RegistryHit> {
  try {
    if ("ico" in query) {
      const hit = await contacts.aresLookup(query.ico);
      return {
        name: hit.legalName,
        ico: hit.ico || null,
        dic: hit.dic,
        street: hit.addressStreet,
        city: hit.addressCity,
        postalCode: hit.addressPostalCode,
        country: hit.addressCountry,
      };
    }
    const [hit] = await lookupVies(query.vat);
    if (!hit) throw new Error("not found");
    return { name: hit.name || null, ico: null, dic: hit.vatId, street: hit.street, city: hit.city, postalCode: hit.postalCode, country: hit.country };
  } catch {
    throw new NotFoundException({ error: "not_found" });
  }
}
