import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

const limits = vi.hoisted(() => ({ spendFeature: vi.fn() }));
vi.mock("../billing/plan-limits", () => limits);

import { ExportsController } from "./exports.controller";
import { FormSchemasService } from "../form-schemas/form-schemas.service";

const TENANT = { id: "t1", dic: "CZ12345678", vatStatus: "payer", country: "CZ" };

/** The real guard over a fake table: `blocked` forms are in status blocked, `xsd` is stored for every form. */
function formSchemas(blocked: string[] = [], xsd: string | null = null) {
  const forms = ["dphdp3", "dphkh1", "dphshv", "dpfdp6", "dpfdp7"];
  const rows = forms.map((form) => ({ form, url: "", hash: null, xsd, status: blocked.includes(form) ? "blocked" : "ok" }));
  const db = { select: () => ({ from: async () => rows }) };
  return new FormSchemasService({ db } as never, { sendPlatformEmail: vi.fn() } as never);
}

function setup(tenant: Record<string, unknown> = TENANT, complete = true, schemas = formSchemas()) {
  const service = {
    pohodaXml: vi.fn(async () => "<pohoda/>"),
    moneyS3Xml: vi.fn(async () => "<money/>"),
    vatReturn: vi.fn(async () => ({ body: "<dp3/>", warnings: [] })),
    vatReturnSk: vi.fn(async () => "<dphv25/>"),
    vatInputs: vi.fn(async () => ({ issued: [] })),
    accountingInputs: vi.fn(async () => ({ invoices: [] })),
    annualSummary: vi.fn(async () => SUMMARY),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = { from: () => chain, where: () => Promise.resolve([tenant]) };
  const req = { tenantDb: { select: () => chain, execute: vi.fn(async () => [{ complete }]) }, user: { tenantId: "t1" } };
  const res = { setHeader: vi.fn(), send: vi.fn() };
  return { controller: new ExportsController(service as never, schemas), service, req, res };
}

const refusal = new ForbiddenException({ error: "plan_required" });

const SEALED_DOC = { encAmounts: "enc:v1:doc", documentType: "invoice", rate: 1 };
let SUMMARY: Record<string, unknown>;
function summary(sealed: boolean) {
  return {
    year: 2025,
    basis: "cash",
    vatPayer: false,
    income: 300_000,
    plainIncome: 300_000,
    actualExpenses: 20_000,
    byCategory: { "": 20_000 },
    flatRate: 60,
    counts: { invoices: 3, expenses: 1, missingRates: 0 },
    social: { paid: 0 },
    health: { paid: 0 },
    sealed: sealed ? { count: 1, ids: ["S"] } : { count: 0, ids: [] },
    sealedDocs: sealed ? [SEALED_DOC] : [],
  };
}

beforeEach(() => {
  limits.spendFeature.mockReset().mockResolvedValue("plan");
  SUMMARY = summary(true);
});

describe("ExportsController plan gates", () => {
  it("spends an accounting-export use on a Pohoda and a Money S3 file", async () => {
    const { controller, req, res } = setup();
    await controller.pohoda(req as never, { month: "2026-03" }, res as never);
    await controller.moneyS3(req as never, { month: "2026-03" }, res as never);
    expect(limits.spendFeature).toHaveBeenNthCalledWith(1, req.tenantDb, "t1", "accounting_export");
    expect(limits.spendFeature).toHaveBeenNthCalledWith(2, req.tenantDb, "t1", "accounting_export");
    expect(res.send).toHaveBeenCalledTimes(2);
  });

  it("sends no file when the plan refuses", async () => {
    limits.spendFeature.mockImplementation(async () => {
      throw refusal;
    });
    const { controller, req, res } = setup();
    await expect(controller.pohoda(req as never, { month: "2026-03" }, res as never)).rejects.toBe(refusal);
    await expect(controller.dp3(req as never, { year: "2026", month: "3" }, res as never)).rejects.toBe(refusal);
    expect(res.send).not.toHaveBeenCalled();
  });

  it("gates the VAT files as vat_filings", async () => {
    const { controller, req, res } = setup();
    await controller.dp3(req as never, { year: "2026", month: "3" }, res as never);
    expect(limits.spendFeature).toHaveBeenCalledWith(req.tenantDb, "t1", "vat_filings");
  });

  it("gates the Slovak VAT files the same way", async () => {
    const { controller, req, res } = setup({ ...TENANT, dic: "SK2020123456", country: "SK" });
    await controller.skDph(req as never, { year: "2026", month: "3" }, res as never);
    expect(limits.spendFeature).toHaveBeenCalledWith(req.tenantDb, "t1", "vat_filings");
    expect(res.send).toHaveBeenCalledTimes(1);
  });

  it("gates the income-tax sheet as income_tax_export", async () => {
    limits.spendFeature.mockImplementation(async () => {
      throw refusal;
    });
    const { controller, req, res } = setup();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(controller as any, "loadTaxReturn").mockResolvedValue({});
    await expect(controller.taxReturnBasisCsv(req as never, {}, res as never)).rejects.toBe(refusal);
    expect(limits.spendFeature).toHaveBeenCalledWith(req.tenantDb, "t1", "income_tax_export");
    expect(res.send).not.toHaveBeenCalled();
  });

  it("spends nothing when there is no file to send", async () => {
    const { controller, service, req, res } = setup();
    service.vatReturn.mockResolvedValue({ body: null as never, warnings: [] });
    await expect(controller.shv(req as never, { year: "2026", month: "3" }, res as never)).rejects.toBeInstanceOf(NotFoundException);
    expect(limits.spendFeature).not.toHaveBeenCalled();
  });
});

describe("ExportsController vat-inputs (sealed amounts, built in the browser)", () => {
  it("counts the filing on the plan, since the file never passes the server", async () => {
    const { controller, service, req } = setup();
    await controller.vatInputs(req as never, { filing: "dphkh1", year: "2026", month: "3" });
    expect(service.vatInputs).toHaveBeenCalledWith(req.tenantDb, { country: "CZ", kind: "kh1" }, expect.anything(), { year: 2026, month: 3 }, TENANT);
    expect(limits.spendFeature).toHaveBeenCalledWith(req.tenantDb, "t1", "vat_filings");
  });

  it("hands out nothing when the plan refuses", async () => {
    limits.spendFeature.mockImplementation(async () => {
      throw refusal;
    });
    const { controller, req } = setup();
    await expect(controller.vatInputs(req as never, { filing: "dphdp3", year: "2026", month: "3" })).rejects.toBe(refusal);
  });

  it("refuses an unknown filing", async () => {
    const { controller, req } = setup();
    for (const filing of ["", "pohoda", "__proto__", "constructor"]) {
      await expect(controller.vatInputs(req as never, { filing, year: "2026", month: "3" })).rejects.toMatchObject({ status: 400 });
    }
  });

  it("applies the same checks as the XML routes", async () => {
    const identified = setup({ ...TENANT, vatStatus: "identified" });
    await expect(identified.controller.vatInputs(identified.req as never, { filing: "dphkh1", year: "2026", month: "3" })).rejects.toMatchObject({
      response: { message: "identified_no_control_statement" },
    });
    await expect(identified.controller.vatInputs(identified.req as never, { filing: "dphdp3", year: "2026", quarter: "1" })).rejects.toMatchObject({
      response: { message: "identified_monthly_only" },
    });
    const czech = setup();
    await expect(czech.controller.vatInputs(czech.req as never, { filing: "sk-kvdph", year: "2026", month: "3" })).rejects.toMatchObject({
      response: { message: "sk_vat_id_required" },
    });
    expect(identified.service.vatInputs).not.toHaveBeenCalled();
    expect(czech.service.vatInputs).not.toHaveBeenCalled();
    // A refused filing is not counted on the plan.
    expect(limits.spendFeature).not.toHaveBeenCalled();
  });
});

describe("ExportsController with a form blocked by the schema check", () => {
  const blocked = { status: 409, message: "form_blocked" };

  it("refuses that form's file and its sealed inputs before anything is built or spent", async () => {
    const { controller, service, req, res } = setup(TENANT, true, formSchemas(["dphkh1"]));
    await expect(controller.kh1(req as never, { year: "2026", month: "3" }, res as never)).rejects.toMatchObject(blocked);
    await expect(controller.vatInputs(req as never, { filing: "dphkh1", year: "2026", month: "3" })).rejects.toMatchObject(blocked);
    expect(service.vatReturn).not.toHaveBeenCalled();
    expect(service.vatInputs).not.toHaveBeenCalled();
    expect(limits.spendFeature).not.toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
  });

  it("leaves the other forms open", async () => {
    const { controller, req, res } = setup(TENANT, true, formSchemas(["dphkh1"]));
    await controller.dp3(req as never, { year: "2026", month: "3" }, res as never);
    await controller.vatInputs(req as never, { filing: "dphshv", year: "2026", month: "3" });
    expect(res.send).toHaveBeenCalledTimes(1);
  });

  it("blocks the DAP form of the year asked for, also for the sealed path", async () => {
    const person = { ...TENANT, legalName: "Jan Novák", addressStreet: "Dlouhá 1", addressCity: "Praha", addressPostalCode: "11000" };
    const { controller, req } = setup(person, true, formSchemas(["dpfdp7"]));
    await expect(controller.filingsInputs(req as never, { year: "2025", activity: "H", file: "dpfdp" })).rejects.toMatchObject(blocked);
    // The inputs without a file to build are the on-screen figures: still open.
    await expect(controller.filingsInputs(req as never, { year: "2025", activity: "H" })).resolves.toMatchObject({ forms: { dpfdp: "DPFDP7" } });
    const older = setup(person, true, formSchemas(["dpfdp6"]));
    await expect(older.controller.filingsInputs(older.req as never, { year: "2025", activity: "H", file: "dpfdp" })).resolves.toBeTruthy();
  });

  it("names what the stored XSD rejects in a real export, without its values", async () => {
    const xsd = `<?xml version="1.0"?><xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="Pisemnost"><xs:complexType><xs:attribute name="c_telef"><xs:simpleType><xs:restriction base="xs:string"><xs:maxLength value="14"/></xs:restriction></xs:simpleType></xs:attribute></xs:complexType></xs:element></xs:schema>`;
    const { controller, service, req, res } = setup(TENANT, true, formSchemas([], xsd));
    service.vatReturn.mockResolvedValue({ body: '<Pisemnost c_telef="+420 777 123 456" />', warnings: [] });
    await controller.dp3(req as never, { year: "2026", month: "3" }, res as never);
    const header = res.setHeader.mock.calls.find(([name]) => name === "X-Schema-Problems");
    expect(JSON.parse(decodeURIComponent(header![1] as string))).toEqual(["Pisemnost/@c_telef: maxLength"]);
    expect(header![1]).not.toContain("777");
    expect(res.send).toHaveBeenCalledTimes(1);
  });
});

describe("ExportsController filings for a member who sees only part of the company", () => {
  it("are refused before anything is computed or spent", async () => {
    const { controller, service, req, res } = setup(TENANT, false);
    const refused = { status: 409, message: "filing_needs_full_view" };
    await expect(controller.dp3(req as never, { year: "2026", month: "3" }, res as never)).rejects.toMatchObject(refused);
    await expect(controller.vatInputs(req as never, { filing: "dphkh1", year: "2026", month: "3" })).rejects.toMatchObject(refused);
    await expect(controller.taxReturnBasisCsv(req as never, { year: "2025" }, res as never)).rejects.toMatchObject(refused);
    const sk = setup({ ...TENANT, dic: "SK2020123456", country: "SK" }, false);
    await expect(sk.controller.skDph(sk.req as never, { year: "2026", month: "3" }, sk.res as never)).rejects.toMatchObject(refused);
    expect(service.vatReturn).not.toHaveBeenCalled();
    expect(service.vatInputs).not.toHaveBeenCalled();
    expect(service.annualSummary).not.toHaveBeenCalled();
    expect(limits.spendFeature).not.toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
  });

  it("leave the accounting exports alone, which are lists rather than filings", async () => {
    const { controller, res, req } = setup(TENANT, false);
    await controller.pohoda(req as never, { month: "2026-03" }, res as never);
    expect(res.send).toHaveBeenCalledTimes(1);
  });
});

describe("ExportsController accounting-inputs (sealed amounts, built in the browser)", () => {
  it("counts the Pohoda or Money S3 file on the plan", async () => {
    const { controller, service, req } = setup();
    await controller.accountingInputs(req as never, { format: "money-s3", month: "2026-03" });
    expect(service.accountingInputs).toHaveBeenCalledWith(req.tenantDb, "money-s3", expect.anything(), TENANT);
    expect(limits.spendFeature).toHaveBeenCalledWith(req.tenantDb, "t1", "accounting_export");
  });

  it("refuses an unknown format before reading anything", async () => {
    const { controller, service, req } = setup();
    await expect(controller.accountingInputs(req as never, { format: "csv", month: "2026-03" })).rejects.toMatchObject({ status: 400 });
    expect(service.accountingInputs).not.toHaveBeenCalled();
    expect(limits.spendFeature).not.toHaveBeenCalled();
  });
});

describe("ExportsController year reports with sealed amounts", () => {
  it("still refuses the tax-return basis, its files and the filings while a document is sealed", async () => {
    const { controller, req, res } = setup();
    await expect(controller.taxReturnBasis(req as never, { year: "2025", rate: "60" })).rejects.toMatchObject({ status: 409 });
    await expect(controller.taxReturnBasisCsv(req as never, { year: "2025", rate: "60" }, res as never)).rejects.toMatchObject({ status: 409 });
    await expect(controller.filings(req as never, { year: "2025", activity: "H" })).rejects.toMatchObject({ status: 409 });
    expect(res.send).not.toHaveBeenCalled();
  });

  it("computes the tax-return basis from the plain income when nothing is sealed", async () => {
    SUMMARY = summary(false);
    const { controller, req } = setup();
    const report = await controller.taxReturnBasis(req as never, { year: "2025", rate: "60" });
    expect(report).toMatchObject({ income: 300_000, counts: { invoices: 3 } });
  });

  it("hands the browser the tax-return inputs with the sealed documents, spending only for a file", async () => {
    const { controller, req } = setup();
    const inputs = await controller.taxReturnInputs(req as never, { year: "2025", rate: "60" });
    expect(inputs).toMatchObject({ year: 2025, plainIncome: 300_000, sealedDocs: [SEALED_DOC], flatRate: 60, country: "CZ" });
    expect(limits.spendFeature).not.toHaveBeenCalled();
    await controller.taxReturnInputs(req as never, { year: "2025", rate: "60", file: "pdf" });
    expect(limits.spendFeature).toHaveBeenCalledWith(req.tenantDb, "t1", "income_tax_export");
  });

  it("hands the browser the filings inputs without any personal data, spending only for a file", async () => {
    const { controller, req } = setup({ ...TENANT, legalName: "Jan Novák", addressStreet: "Dlouhá 1", addressCity: "Praha", addressPostalCode: "11000" });
    const inputs = await controller.filingsInputs(req as never, { year: "2025", activity: "H" });
    expect(inputs).toMatchObject({ plainIncome: 300_000, sealedDocs: [SEALED_DOC], forms: { dpfdp: "DPFDP7", cssz: true } });
    expect(inputs.figures).toMatchObject({ year: 2025, flatRate: 60, activity: "H" });
    expect(JSON.stringify(inputs)).not.toMatch(/birthNumber|dataBox/);
    expect(limits.spendFeature).not.toHaveBeenCalled();
    await controller.filingsInputs(req as never, { year: "2025", activity: "H", file: "osvc" });
    expect(limits.spendFeature).toHaveBeenCalledWith(req.tenantDb, "t1", "income_tax_export");
  });

  it("spends nothing for a filing whose form is not published for the year", async () => {
    SUMMARY = { ...summary(true), year: 2020 };
    const { controller, req } = setup();
    await expect(controller.filingsInputs(req as never, { year: "2020", activity: "H", file: "dpfdp" })).rejects.toMatchObject({ status: 404 });
    expect(limits.spendFeature).not.toHaveBeenCalled();
  });

  it("gives a Slovak company no Czech filings inputs", async () => {
    const { controller, req } = setup({ ...TENANT, dic: "SK2020123456", country: "SK" });
    await expect(controller.filingsInputs(req as never, { year: "2025", activity: "H" })).rejects.toMatchObject({ status: 400 });
  });
});
