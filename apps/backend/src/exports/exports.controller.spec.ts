import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

const limits = vi.hoisted(() => ({ spendFeature: vi.fn() }));
vi.mock("../billing/plan-limits", () => limits);

import { ExportsController } from "./exports.controller";

const TENANT = { id: "t1", dic: "CZ12345678", vatStatus: "payer", country: "CZ" };

function setup(tenant: Record<string, unknown> = TENANT) {
  const service = {
    pohodaXml: vi.fn(async () => "<pohoda/>"),
    moneyS3Xml: vi.fn(async () => "<money/>"),
    vatReturn: vi.fn(async () => ({ body: "<dp3/>", warnings: [] })),
    vatReturnSk: vi.fn(async () => "<dphv25/>"),
    vatInputs: vi.fn(async () => ({ issued: [] })),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = { from: () => chain, where: () => Promise.resolve([tenant]) };
  const req = { tenantDb: { select: () => chain }, user: { tenantId: "t1" } };
  const res = { setHeader: vi.fn(), send: vi.fn() };
  return { controller: new ExportsController(service as never), service, req, res };
}

const refusal = new ForbiddenException({ error: "plan_required" });

beforeEach(() => {
  limits.spendFeature.mockReset().mockResolvedValue("plan");
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
