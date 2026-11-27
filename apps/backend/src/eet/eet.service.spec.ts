import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getTableColumns, is, SQL, type Column } from "drizzle-orm";
import { PgDialect, type PgTable } from "drizzle-orm/pg-core";
import type { SendEetResult } from "@faktur/cz-compliance/eet";
import * as schema from "../../drizzle/schema";
import { decryptSecret } from "../backup-destinations/encryption.util";
import { EetService, type EetTransport } from "./eet.service";

// The official playground certificates (public, published with the EET
// interface); the transport is faked, so nothing leaves the machine.
const fixtures = join(__dirname, "../../../../packages/cz-compliance/src/__tests__/fixtures/eet");
const p12 = () => readFileSync(join(fixtures, "CA_EET-Playground-CZ00000019.p12"));
const password = () => readFileSync(join(fixtures, "playground-password.txt"), "utf8").trim();

beforeAll(() => {
  process.env.BACKUP_CONFIG_ENCRYPTION_KEY ??= "ab".repeat(32);
});

type Row = Record<string, unknown>;
const dialect = new PgDialect();

/**
 * Just enough of Drizzle for EetService: rows keyed by the schema's JS
 * names, `eq(column, value)` filters (anything else matches all rows), and
 * `column + 1` in a SET.
 */
function fakeDb(tables: Map<PgTable, Row[]>) {
  const keyOf = (table: PgTable, col: Column) => Object.entries(getTableColumns(table)).find(([, c]) => c === col)?.[0];
  const matches = (table: PgTable, where: SQL | undefined) => (row: Row) => {
    if (!where) return true;
    const q = dialect.sqlToQuery(where);
    const m = /^"\w+"\."(\w+)" = \$1$/.exec(q.sql);
    if (!m) return true;
    const key = Object.entries(getTableColumns(table)).find(([, c]) => c.name === m[1])?.[0];
    return key ? row[key] === q.params[0] : true;
  };
  const project = (table: PgTable, row: Row, proj?: Record<string, unknown>) =>
    proj ? Object.fromEntries(Object.entries(proj).map(([k, col]) => [k, is(col, SQL) ? undefined : row[keyOf(table, col as Column)!]])) : { ...row };
  const chain = (run: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["orderBy", "limit", "groupBy", "for"]) c[m] = () => c;
    c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(run).then(res, rej);
    return c;
  };
  const rows = (t: PgTable) => tables.get(t) ?? tables.set(t, []).get(t)!;
  return {
    select: (proj?: Record<string, unknown>) => ({
      from: (table: PgTable) => {
        let where: SQL | undefined;
        const c = chain(() => rows(table).filter(matches(table, where)).map((r) => project(table, r, proj)));
        return Object.assign(c, { where: (w: SQL) => ((where = w), c) });
      },
    }),
    update: (table: PgTable) => ({
      set: (values: Row) => {
        let where: SQL | undefined;
        let proj: Record<string, unknown> | undefined;
        const apply = () =>
          rows(table)
            .filter(matches(table, where))
            .map((r) => {
              for (const [k, v] of Object.entries(values)) r[k] = is(v, SQL) ? Number(r[k]) + 1 : v;
              return project(table, r, proj);
            });
        const c = chain(apply);
        return Object.assign(c, {
          where: (w: SQL) => ((where = w), Object.assign(c, { returning: (p?: Record<string, unknown>) => ((proj = p), c) })),
        });
      },
    }),
    insert: (table: PgTable) => ({
      values: (v: Row) => ({
        returning: () =>
          chain(() => {
            const row = {
              id: randomUUID(),
              status: "pending",
              pok: null,
              test: null,
              attempts: 0,
              lastError: null,
              warnings: [],
              transactionId: null,
              createdAt: new Date(),
              lastAttemptAt: null,
              confirmedAt: null,
              ...v,
            };
            rows(table).push(row);
            return [{ ...row }];
          }),
      }),
    }),
  };
}

const TENANT = "11111111-1111-4111-8111-111111111111";
const INVOICE = "22222222-2222-4222-8222-222222222222";
const POK = "0f7e5c39-8a6b-4f2d-9c11-2e3a4b5c6d7e-ff";
const confirmed: SendEetResult = {
  sent: true,
  httpStatus: 200,
  transactionId: "tx-1",
  response: { kind: "confirmed", pok: POK, uuidZpravy: null, datPrij: null, test: true, warnings: [] },
};

function tenantRow(over: Row = {}): Row {
  return {
    id: TENANT,
    dic: "CZ00000019",
    country: "CZ",
    isDemo: false,
    eetEnabled: false,
    eetEnvironment: "playground",
    eetIdJednotky: null,
    eetIdPokl: null,
    eetCardInPerson: false,
    eetCertificateEncrypted: null,
    eetCertificateInfo: null,
    eetLastPoradCis: 0,
    ...over,
  };
}

const invoice = (over: Row = {}) =>
  ({
    id: INVOICE,
    tenantId: TENANT,
    paymentMethod: "cash",
    documentType: "invoice",
    currency: "CZK",
    exchangeRate: null,
    amountPaid: "0",
    encAmounts: null,
    eetPok: null,
    ...over,
  }) as unknown as typeof schema.invoices.$inferSelect;

/** A company with the playground certificate uploaded through the service, and EET switched on. */
async function setup(transport: EetTransport, tenant: Row = {}) {
  const tables = new Map<PgTable, Row[]>([
    [schema.tenants, [tenantRow(tenant)]],
    [schema.invoices, [{ ...invoice() }]],
    [schema.eetRecords, []],
  ]);
  const db = fakeDb(tables) as never;
  const service = new EetService(transport);
  await service.uploadCertificate(db, TENANT, p12(), password());
  await service.updateSettings(db, TENANT, { enabled: true, idJednotky: "61", idPokl: "88-2" });
  return { db, service, tables, records: () => tables.get(schema.eetRecords)!, tenant: () => tables.get(schema.tenants)![0]! };
}

describe("EetService certificate upload", () => {
  it("stores the .p12 encrypted with only its public details in the clear", async () => {
    const { tenant } = await setup(vi.fn());
    const t = tenant();
    expect(t.eetCertificateInfo).toMatchObject({ commonName: "CZ00000019" });
    const stored = t.eetCertificateEncrypted as string;
    expect(stored).not.toContain(password());
    expect(JSON.stringify(t)).not.toContain(p12().toString("base64").slice(0, 40));
    expect(JSON.parse(decryptSecret(stored, process.env.BACKUP_CONFIG_ENCRYPTION_KEY))).toMatchObject({ password: password() });
  });

  it("refuses a wrong password and garbage with stable codes", async () => {
    const db = fakeDb(new Map<PgTable, Row[]>([[schema.tenants, [tenantRow()]]])) as never;
    const service = new EetService(vi.fn());
    await expect(service.uploadCertificate(db, TENANT, p12(), "wrong")).rejects.toThrow("wrong_password");
    await expect(service.uploadCertificate(db, TENANT, Buffer.from("not a p12 file"), "x")).rejects.toThrow("invalid_p12");
  });
});

describe("EetService settings", () => {
  const db = () => fakeDb(new Map<PgTable, Row[]>([[schema.tenants, [tenantRow()]], [schema.eetRecords, []]])) as never;

  it("can't be switched on without a certificate", async () => {
    await expect(new EetService(vi.fn()).updateSettings(db(), TENANT, { enabled: true, idJednotky: "61", idPokl: "1" })).rejects.toThrow("certificate_missing");
  });

  it("rejects an evidenční jednotka DIS+ would not assign and a bad pokladna", async () => {
    await expect(new EetService(vi.fn()).updateSettings(db(), TENANT, { idJednotky: "65" })).rejects.toThrow("invalid_id_jednotky");
    await expect(new EetService(vi.fn()).updateSettings(db(), TENANT, { idPokl: "Pokladna č. 1" })).rejects.toThrow("invalid_id_pokl");
  });

  it("is for Czech companies only", async () => {
    const sk = fakeDb(new Map<PgTable, Row[]>([[schema.tenants, [tenantRow({ country: "SK", eetCertificateInfo: { validTo: "2099-01-01" } })]]])) as never;
    await expect(new EetService(vi.fn()).updateSettings(sk, TENANT, { enabled: true, idJednotky: "61", idPokl: "1" })).rejects.toThrow("eet_cz_only");
  });

  it("defaults to the playground", async () => {
    const { service, db: d } = await setup(vi.fn());
    expect((await service.getSettings(d, TENANT)).environment).toBe("playground");
  });
});

describe("EetService.recordInvoicePayment", () => {
  const now = new Date("2027-03-05T11:25:01Z");

  it("signs and sends a cash payment, stores the POK on the record and the invoice", async () => {
    const transport = vi.fn<EetTransport>().mockResolvedValue(confirmed);
    const { db, service, records, tables } = await setup(transport);
    const result = await service.recordInvoicePayment(db, invoice(), invoice({ amountPaid: "250.00" }), { now });
    expect(result).toEqual({ recorded: true, recordId: expect.any(String), status: "confirmed", pok: POK, test: true, error: null });
    const [xml, env, timeout] = transport.mock.calls[0]!;
    expect(env).toBe("playground");
    expect(timeout).toBeGreaterThanOrEqual(2000);
    expect(xml).toContain('prvni_zaslani="true"');
    expect(xml).toContain(
      '<v4:Data celk_trzba="250.00" dat_trzby="2027-03-05T12:25:01+01:00" eic_popl="CZ00000019" id_jednotky="61" id_pokl="88-2" porad_cis="1"/>',
    );
    expect(records()[0]).toMatchObject({ status: "confirmed", pok: POK, attempts: 1, kind: "sale", celkTrzba: "250.00" });
    expect(tables.get(schema.invoices)![0]!.eetPok).toBe(POK);
  });

  it("numbers records one after another", async () => {
    const transport = vi.fn<EetTransport>().mockResolvedValue(confirmed);
    const { db, service, records } = await setup(transport);
    await service.recordInvoicePayment(db, invoice(), invoice({ amountPaid: "100" }), { now });
    await service.recordInvoicePayment(db, invoice({ amountPaid: "100" }), invoice({ amountPaid: "150" }), { now });
    expect(records().map((r) => [r.poradCis, r.celkTrzba])).toEqual([
      ["1", "100.00"],
      ["2", "50.00"],
    ]);
  });

  it("sends nothing for a bank transfer, or while EET is off", async () => {
    const transport = vi.fn<EetTransport>();
    const { db, service, records } = await setup(transport);
    expect(await service.recordInvoicePayment(db, invoice(), invoice({ paymentMethod: "bank_transfer", amountPaid: "10" }), { now })).toEqual({
      recorded: false,
      reason: "not_contact_payment",
    });
    await service.updateSettings(db, TENANT, { enabled: false });
    expect(await service.recordInvoicePayment(db, invoice(), invoice({ amountPaid: "10" }), { now })).toEqual({ recorded: false, reason: "disabled" });
    expect(transport).not.toHaveBeenCalled();
    expect(records()).toHaveLength(0);
  });

  it("records a card payment only when cards are taken in person", async () => {
    const transport = vi.fn<EetTransport>().mockResolvedValue(confirmed);
    const { db, service } = await setup(transport);
    const card = invoice({ paymentMethod: "card", amountPaid: "10" });
    expect(await service.recordInvoicePayment(db, invoice(), card, { now })).toMatchObject({ recorded: false });
    await service.updateSettings(db, TENANT, { cardInPerson: true });
    expect(await service.recordInvoicePayment(db, invoice(), card, { now })).toMatchObject({ recorded: true });
  });

  it("keeps a record pending when the answer doesn't come in time", async () => {
    const transport = vi.fn<EetTransport>().mockResolvedValue({ sent: false, reason: "timeout", transactionId: null });
    const { db, service, records, tables } = await setup(transport);
    const result = await service.recordInvoicePayment(db, invoice(), invoice({ amountPaid: "250" }), { now });
    expect(result).toMatchObject({ recorded: true, status: "pending", pok: null, error: "timeout" });
    expect(records()[0]).toMatchObject({ status: "pending", attempts: 1 });
    expect(tables.get(schema.invoices)![0]!.eetPok).toBeNull();
  });

  it("rejects for good on an error other than -1", async () => {
    const transport = vi.fn<EetTransport>().mockResolvedValue({
      sent: true,
      httpStatus: 200,
      transactionId: null,
      response: { kind: "error", code: 4, text: "Neplatny podpis", uuidZpravy: null, datOdmit: null, test: true, retryable: false, warnings: [] },
    });
    const { db, service, records } = await setup(transport);
    await service.recordInvoicePayment(db, invoice(), invoice({ amountPaid: "250" }), { now });
    expect(records()[0]).toMatchObject({ status: "rejected", lastError: "eet_error_4" });
  });
});

describe("EetService resend (§ 20)", () => {
  const sale = new Date("2027-03-05T11:25:01Z");

  it("repeats the same <Data> with prvni_zaslani=false and a new message UUID", async () => {
    const transport = vi.fn<EetTransport>().mockResolvedValueOnce({ sent: false, reason: "network", transactionId: null }).mockResolvedValue(confirmed);
    const { db, service, records } = await setup(transport);
    await service.recordInvoicePayment(db, invoice(), invoice({ amountPaid: "250" }), { now: sale });
    const confirmedCount = await service.sweepTenant(db, TENANT, new Date(sale.getTime() + 5 * 60_000));
    expect(confirmedCount).toBe(1);
    const [first, second] = transport.mock.calls.map((c) => c[0]);
    const data = (x: string) => /<v4:Data[^>]*\/>/.exec(x)![0];
    const uuid = (x: string) => /uuid_zpravy="([^"]+)"/.exec(x)![1];
    expect(data(second!)).toBe(data(first!));
    expect(uuid(second!)).not.toBe(uuid(first!));
    expect(first).toContain('prvni_zaslani="true"');
    expect(second).toContain('prvni_zaslani="false"');
    expect(records()[0]).toMatchObject({ status: "confirmed", attempts: 2, pok: POK });
  });

  it("waits between sweeps instead of resending on every run", async () => {
    const transport = vi.fn<EetTransport>().mockResolvedValue({ sent: false, reason: "network", transactionId: null });
    const { db, service } = await setup(transport);
    await service.recordInvoicePayment(db, invoice(), invoice({ amountPaid: "250" }), { now: sale });
    await service.sweepTenant(db, TENANT, new Date(sale.getTime() + 60_000));
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("sends a record to the environment it was made in, even after switching", async () => {
    const transport = vi.fn<EetTransport>().mockResolvedValueOnce({ sent: false, reason: "network", transactionId: null }).mockResolvedValue(confirmed);
    const { db, service } = await setup(transport);
    await service.recordInvoicePayment(db, invoice(), invoice({ amountPaid: "250" }), { now: sale });
    await service.updateSettings(db, TENANT, { environment: "production" });
    await service.sweepTenant(db, TENANT, new Date(sale.getTime() + 5 * 60_000));
    expect(transport.mock.calls.map((c) => c[1])).toEqual(["playground", "playground"]);
  });

  it("flags a record unanswered after 48 hours as overdue", async () => {
    const transport = vi.fn<EetTransport>().mockResolvedValue({ sent: false, reason: "network", transactionId: null });
    const { db, service, records } = await setup(transport);
    await service.recordInvoicePayment(db, invoice(), invoice({ amountPaid: "250" }), { now: sale });
    await service.sweepTenant(db, TENANT, new Date(sale.getTime() + 49 * 3600_000));
    expect(records()[0]).toMatchObject({ status: "overdue", attempts: 2 });
  });
});

describe("EetService.recordInvoiceReversal (§ 8)", () => {
  it("sends the recorded sum back as a negative record and clears the POK", async () => {
    const transport = vi.fn<EetTransport>().mockResolvedValue(confirmed);
    const { db, service, records, tables } = await setup(transport);
    const now = new Date("2027-03-05T11:25:01Z");
    await service.recordInvoicePayment(db, invoice(), invoice({ amountPaid: "250" }), { now });
    const result = await service.recordInvoiceReversal(db, invoice({ status: "issued" }), { now });
    expect(result).toMatchObject({ recorded: true, status: "confirmed" });
    expect(records().map((r) => [r.kind, r.celkTrzba])).toEqual([
      ["sale", "250.00"],
      ["refund", "-250.00"],
    ]);
    expect(transport.mock.calls[1]![0]).toContain('celk_trzba="-250.00"');
    expect(tables.get(schema.invoices)![0]!.eetPok).toBeNull();
  });

  it("does nothing for a document with no records", async () => {
    const transport = vi.fn<EetTransport>();
    const { db, service } = await setup(transport);
    expect(await service.recordInvoiceReversal(db, invoice())).toEqual({ recorded: false, reason: "zero_amount" });
    expect(transport).not.toHaveBeenCalled();
  });
});
