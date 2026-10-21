import { readdirSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import type { ExportBundle } from "./export.service";
import { SqliteExportService } from "./sqlite-export.service";

/**
 * Real end-to-end round-trip: build a small fixture `ExportBundle` (the same
 * shape `ExportService.buildExportBundle` produces), generate the SQLite
 * file with `SqliteExportService`, write the returned `Buffer` BACK to a
 * throwaway file this test owns, and re-open THAT file with a fresh
 * `better-sqlite3` connection to prove the bytes really are a valid,
 * queryable SQLite database with the expected rows in it — not just a
 * Buffer of the right length. Also confirms the service's OWN internal temp
 * file is actually deleted afterwards, per this feature's spec.
 */
function buildFixtureBundle(): ExportBundle {
  return {
    exportedAt: "2026-09-09T12:00:00.000Z",
    tenant: {
      id: "11111111-1111-1111-1111-111111111111",
      companyName: "Acme Consulting s.r.o.",
      legalName: "Acme Consulting, s.r.o.",
      ico: "12345678",
      dic: "CZ12345678",
    },
    invoices: [
      {
        id: "22222222-2222-2222-2222-222222222222",
        tenantId: "11111111-1111-1111-1111-111111111111",
        contactId: "33333333-3333-3333-3333-333333333333",
        invoiceNumber: "2026-0001",
        variableSymbol: "20260001",
        issueDate: new Date("2026-09-01T00:00:00.000Z"),
        dueDate: new Date("2026-09-15T00:00:00.000Z"),
        currency: "CZK",
        status: "issued",
        source: "manual",
        aiConfidenceScore: null,
        issuedByUserId: null,
        issuedAt: new Date("2026-09-01T08:00:00.000Z"),
        aiDraftReviewedAt: null,
        needsAttention: false,
        rawAiPayload: null,
        publicToken: "44444444-4444-4444-4444-444444444444",
        sentAt: null,
        lastReminderSentAt: null,
        reminderCount: 0,
        createdAt: new Date("2026-09-01T07:00:00.000Z"),
        updatedAt: new Date("2026-09-01T08:00:00.000Z"),
        lineItems: [
          {
            id: "55555555-5555-5555-5555-555555555555",
            tenantId: "11111111-1111-1111-1111-111111111111",
            invoiceId: "22222222-2222-2222-2222-222222222222",
            description: "Consulting services – September",
            quantity: "10.000",
            unitPrice: "1500.00",
            vatRate: "21.00",
            sortOrder: 0,
            createdAt: new Date("2026-09-01T07:00:00.000Z"),
          },
        ],
      },
    ] as unknown as ExportBundle["invoices"],
    contacts: [
      {
        id: "33333333-3333-3333-3333-333333333333",
        tenantId: "11111111-1111-1111-1111-111111111111",
        ico: "87654321",
        dic: "CZ87654321",
        legalName: "Client s.r.o.",
        email: "client@example.com",
        addressStreet: "Hlavní 1",
        addressCity: "Praha",
        addressPostalCode: "11000",
        addressCountry: "CZ",
        aresVerifiedAt: new Date("2026-08-01T00:00:00.000Z"),
        isVatPayer: true,
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        updatedAt: new Date("2026-08-01T00:00:00.000Z"),
      },
    ] as unknown as ExportBundle["contacts"],
    expenses: [
      {
        id: "66666666-6666-6666-6666-666666666666",
        tenantId: "11111111-1111-1111-1111-111111111111",
        supplierContactId: null,
        supplierNameRaw: "Office Supplies Ltd.",
        description: "Printer paper",
        amount: "450.50",
        vatRate: "21.00",
        currency: "CZK",
        expenseDate: new Date("2026-08-15T00:00:00.000Z"),
        category: "office",
        receiptFileUrl: null,
        createdAt: new Date("2026-08-15T09:00:00.000Z"),
      },
    ] as unknown as ExportBundle["expenses"],
  };
}

const TEMP_PREFIX = "faktur-sqlite-export-";

describe("SqliteExportService", () => {
  let service: SqliteExportService;

  beforeEach(() => {
    service = new SqliteExportService();
  });

  it("generates a real, queryable SQLite database file from an export bundle", async () => {
    const bundle = buildFixtureBundle();
    const buffer = await service.buildSqliteFile(bundle);

    expect(buffer.length).toBeGreaterThan(0);
    // SQLite files always start with this 16-byte magic header.
    expect(buffer.subarray(0, 16).toString("utf8")).toBe("SQLite format 3\0");

    const roundTripPath = join(tmpdir(), `sqlite-export-roundtrip-test-${Date.now()}.db`);
    writeFileSync(roundTripPath, buffer);

    try {
      const db = new Database(roundTripPath, { readonly: true });
      try {
        const metadata = db.prepare("SELECT * FROM export_metadata WHERE id = 1").get() as Record<
          string,
          unknown
        >;
        expect(metadata.tenant_company_name).toBe("Acme Consulting s.r.o.");
        expect(metadata.exported_at).toBe("2026-09-09T12:00:00.000Z");

        const contacts = db.prepare("SELECT * FROM contacts").all() as Record<string, unknown>[];
        expect(contacts).toHaveLength(1);
        expect(contacts[0].legal_name).toBe("Client s.r.o.");
        expect(contacts[0].is_vat_payer).toBe(1);

        const invoices = db.prepare("SELECT * FROM invoices").all() as Record<string, unknown>[];
        expect(invoices).toHaveLength(1);
        expect(invoices[0].invoice_number).toBe("2026-0001");
        expect(invoices[0].needs_attention).toBe(0);

        const lineItems = db
          .prepare("SELECT * FROM invoice_line_items WHERE invoice_id = ?")
          .all("22222222-2222-2222-2222-222222222222") as Record<string, unknown>[];
        expect(lineItems).toHaveLength(1);
        expect(lineItems[0].description).toBe("Consulting services – September");
        expect(lineItems[0].unit_price).toBe("1500.00");

        // Real relational join, not just a JSON blob — confirms the FK
        // between invoice_line_items and invoices is queryable.
        const joined = db
          .prepare(
            `SELECT i.invoice_number, li.description
             FROM invoice_line_items li
             JOIN invoices i ON i.id = li.invoice_id`,
          )
          .all() as Record<string, unknown>[];
        expect(joined).toEqual([
          { invoice_number: "2026-0001", description: "Consulting services – September" },
        ]);

        const expenses = db.prepare("SELECT * FROM expenses").all() as Record<string, unknown>[];
        expect(expenses).toHaveLength(1);
        expect(expenses[0].amount).toBe("450.50");
        expect(expenses[0].supplier_name_raw).toBe("Office Supplies Ltd.");
      } finally {
        db.close();
      }
    } finally {
      unlinkSync(roundTripPath);
    }
  });

  it("deletes its own internal temp file after generating the buffer (success case)", async () => {
    const before = readdirSync(tmpdir()).filter((name) => name.startsWith(TEMP_PREFIX));
    expect(before).toHaveLength(0);

    await service.buildSqliteFile(buildFixtureBundle());

    const after = readdirSync(tmpdir()).filter((name) => name.startsWith(TEMP_PREFIX));
    expect(after).toHaveLength(0);
  });

  it("produces an empty-but-valid database for a bundle with no rows", async () => {
    const emptyBundle: ExportBundle = {
      exportedAt: "2026-09-09T12:00:00.000Z",
      tenant: {
        id: "11111111-1111-1111-1111-111111111111",
        companyName: "Empty Co",
        legalName: "Empty Co s.r.o.",
        ico: null,
        dic: null,
      },
      invoices: [],
      contacts: [],
      expenses: [],
    };

    const buffer = await service.buildSqliteFile(emptyBundle);
    const roundTripPath = join(tmpdir(), `sqlite-export-empty-test-${Date.now()}.db`);
    writeFileSync(roundTripPath, buffer);

    try {
      const db = new Database(roundTripPath, { readonly: true });
      try {
        expect(db.prepare("SELECT COUNT(*) AS n FROM invoices").get()).toEqual({ n: 0 });
        expect(db.prepare("SELECT COUNT(*) AS n FROM contacts").get()).toEqual({ n: 0 });
        expect(db.prepare("SELECT COUNT(*) AS n FROM expenses").get()).toEqual({ n: 0 });
      } finally {
        db.close();
      }
    } finally {
      unlinkSync(roundTripPath);
    }
  });
});
