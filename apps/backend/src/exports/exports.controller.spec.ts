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
