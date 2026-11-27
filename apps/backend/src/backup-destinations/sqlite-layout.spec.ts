import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "../../drizzle/schema";
import type { ExportBundle } from "./export.service";
import { sqliteLayout, type SqliteTable } from "./sqlite-layout";

// The layout is checked without better-sqlite3 (its native binding does not
// build everywhere); sqlite-export.service.spec.ts runs the real file.

const TENANT = "11111111-1111-1111-1111-111111111111";
const DOC_ENVELOPE = "enc:v1:doc-totals";
const ITEM_ENVELOPE = "enc:v1:item-amounts";

function sealedBundle(): ExportBundle {
  return {
    exportedAt: "2026-11-27T12:00:00.000Z",
    tenant: { id: TENANT, companyName: "Acme", legalName: "Acme s.r.o.", ico: null, dic: null },
    invoices: [
      {
        id: "inv-1",
        tenantId: TENANT,
        invoiceNumber: "2026-0001",
        status: "issued",
        encAmounts: DOC_ENVELOPE,
        noteAbove: "enc:v1:note",
        isPrivate: true,
        issueDate: new Date("2026-11-01T00:00:00.000Z"),
        lineItems: [
          {
            id: "li-1",
            tenantId: TENANT,
            invoiceId: "inv-1",
            description: "enc:v1:desc",
            quantity: "1.000",
            unitPrice: "0.00",
            vatRate: null,
            discountPercent: "0.00",
            encAmounts: ITEM_ENVELOPE,
            sortOrder: 0,
          },
        ],
      },
    ] as unknown as ExportBundle["invoices"],
    contacts: [
      { id: "c-1", tenantId: TENANT, legalName: "enc:v1:name", phone: "enc:v1:phone", contactPerson: "enc:v1:person", internalNote: "enc:v1:note" },
    ] as unknown as ExportBundle["contacts"],
    expenses: [],
    recurringTemplates: [
      { id: "r-1", tenantId: TENANT, encAmounts: "enc:v1:template", lineItemsSnapshot: [{ encAmounts: "enc:v1:snap" }] },
    ] as unknown as ExportBundle["recurringTemplates"],
    vault: {
      settings: { tenantId: TENANT, keyCheck: "enc:v1:check", categories: ["texts", "amounts"] },
      wraps: [{ id: "w-1", tenantId: TENANT, kind: "recovery", kdf: "hkdf-sha256", salt: "s", iv: "i", wrappedKey: "k" }],
    } as unknown as ExportBundle["vault"],
  };
}

function table(tables: SqliteTable[], name: string): SqliteTable {
  const t = tables.find((x) => x.name === name);
  if (!t) throw new Error(`no table ${name}`);
  return t;
}

function cell(t: SqliteTable, row: number, column: string) {
  return t.rows[row]![t.columns.indexOf(column)];
}

describe("sqliteLayout", () => {
  it("keeps the sealed amounts' envelopes next to the placeholders", () => {
    const tables = sqliteLayout(sealedBundle());
    const invoices = table(tables, "invoices");
    const items = table(tables, "invoice_line_items");
    expect(cell(invoices, 0, "enc_amounts")).toBe(DOC_ENVELOPE);
    expect(cell(items, 0, "enc_amounts")).toBe(ITEM_ENVELOPE);
    expect(cell(items, 0, "unit_price")).toBe("0.00");
    expect(cell(items, 0, "discount_percent")).toBe("0.00");
    expect(cell(invoices, 0, "is_private")).toBe(1);
    expect(cell(invoices, 0, "issue_date")).toBe("2026-11-01T00:00:00.000Z");
  });

  it("carries sealed contact fields, templates and the vault's recovery wrap", () => {
    const tables = sqliteLayout(sealedBundle());
    const contacts = table(tables, "contacts");
    expect(cell(contacts, 0, "phone")).toBe("enc:v1:phone");
    expect(cell(contacts, 0, "contact_person")).toBe("enc:v1:person");
    expect(cell(contacts, 0, "internal_note")).toBe("enc:v1:note");
    const templates = table(tables, "recurring_invoice_templates");
    expect(cell(templates, 0, "enc_amounts")).toBe("enc:v1:template");
    expect(cell(templates, 0, "line_items_snapshot")).toBe(JSON.stringify([{ encAmounts: "enc:v1:snap" }]));
    expect(cell(table(tables, "tenant_vaults"), 0, "key_check")).toBe("enc:v1:check");
    expect(cell(table(tables, "vault_key_wraps"), 0, "wrapped_key")).toBe("k");
  });

  it("has every column of the Postgres tables, so a new migration cannot fall out of the backup", () => {
    const tables = sqliteLayout(sealedBundle());
    for (const t of [schema.invoices, schema.invoiceLineItems, schema.contacts, schema.expenses, schema.recurringInvoiceTemplates, schema.tenantVaults, schema.vaultKeyWraps]) {
      const config = getTableConfig(t);
      expect(table(tables, config.name).columns.sort()).toEqual(config.columns.map((c) => c.name).sort());
    }
    expect(table(tables, "invoices").columns).not.toContain("line_items");
  });

  it("leaves the vault tables out for a company without Confidential mode", () => {
    const bundle = { ...sealedBundle(), vault: null };
    expect(sqliteLayout(bundle).map((t) => t.name)).not.toContain("vault_key_wraps");
  });

  it("types money as TEXT and booleans as INTEGER", () => {
    const ddl = table(sqliteLayout(sealedBundle()), "invoice_line_items").ddl;
    expect(ddl).toContain('"unit_price" TEXT');
    expect(ddl).toContain('"sort_order" INTEGER');
    expect(ddl).toContain('"invoice_id" TEXT REFERENCES invoices(id)');
    expect(ddl).toContain('"id" TEXT PRIMARY KEY');
  });
});

describe("backupWraps", () => {
  it("keeps only the recovery-code wrap, never a member's password or passkey wrap", async () => {
    const { backupWraps } = await import("./export.service");
    const wraps = [{ kind: "password" }, { kind: "recovery" }, { kind: "passkey" }];
    expect(backupWraps(wraps)).toEqual([{ kind: "recovery" }]);
  });
});
