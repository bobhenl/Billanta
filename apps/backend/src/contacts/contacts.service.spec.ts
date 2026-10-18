import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbService } from "../db/db.service";
import { ContactsService, hasSlowPart } from "./contacts.service";

const { getSubjectByIcoMock, getRpoSubjectByIcoMock, searchRpoSubjectsMock, searchSubjectsTypeaheadMock } = vi.hoisted(() => ({
  getSubjectByIcoMock: vi.fn(),
  getRpoSubjectByIcoMock: vi.fn(),
  searchRpoSubjectsMock: vi.fn(),
  searchSubjectsTypeaheadMock: vi.fn(),
}));

// Every registry client is mocked, so no test reaches a real register; the pure helpers stay real.
vi.mock("@faktur/cz-compliance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@faktur/cz-compliance")>()),
  getSubjectByIco: getSubjectByIcoMock,
  getRpoSubjectByIco: getRpoSubjectByIcoMock,
  searchRpoSubjects: searchRpoSubjectsMock,
  searchSubjectsTypeahead: searchSubjectsTypeaheadMock,
}));

const SUBJECT = {
  ico: "27604977",
  dic: "CZ27604977",
  obchodniJmeno: "Novák Consulting s.r.o.",
  sidlo: { nazevObce: "Praha", psc: 11800, kodStatu: "CZ" },
};

/** Minimal fake of `.select().from().where().limit()` returning a fixed result. */
function makeSelectChain<T>(result: T[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(() => Promise.resolve(result));
  return chain;
}

function makeInsertChain() {
  const onConflictDoUpdate = vi.fn(() => Promise.resolve(undefined));
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  return { insert: vi.fn(() => ({ values })), values, onConflictDoUpdate };
}

describe("ContactsService.aresLookup", () => {
  beforeEach(() => {
    getSubjectByIcoMock.mockReset();
  });

  it("calls ARES for real on a cache miss and stores the result", async () => {
    const select = vi.fn().mockReturnValueOnce(makeSelectChain([]));
    const { insert, values, onConflictDoUpdate } = makeInsertChain();
    getSubjectByIcoMock.mockResolvedValue(SUBJECT);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbService = { db: { select, insert } } as unknown as DbService;
    const service = new ContactsService(dbService);

    const result = await service.aresLookup("27604977");

    expect(getSubjectByIcoMock).toHaveBeenCalledWith("27604977");
    expect(insert).toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ ico: "27604977", responsePayload: SUBJECT }),
    );
    expect(onConflictDoUpdate).toHaveBeenCalled();
    expect(result.legalName).toBe("Novák Consulting s.r.o.");
  });

  it("serves from cache without calling ARES when the cached row is fresh", async () => {
    const cachedRow = { ico: "27604977", responsePayload: SUBJECT, fetchedAt: new Date() };
    const select = vi.fn().mockReturnValueOnce(makeSelectChain([cachedRow]));
    const { insert } = makeInsertChain();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbService = { db: { select, insert } } as unknown as DbService;
    const service = new ContactsService(dbService);

    const result = await service.aresLookup("27604977");

    expect(getSubjectByIcoMock).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(result.ico).toBe("27604977");
  });

  it("re-fetches from ARES when the cached row is older than the 24h TTL", async () => {
    const staleRow = {
      ico: "27604977",
      responsePayload: SUBJECT,
      fetchedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    };
    const select = vi.fn().mockReturnValueOnce(makeSelectChain([staleRow]));
    const { insert } = makeInsertChain();
    getSubjectByIcoMock.mockResolvedValue(SUBJECT);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbService = { db: { select, insert } } as unknown as DbService;
    const service = new ContactsService(dbService);

    await service.aresLookup("27604977");

    expect(getSubjectByIcoMock).toHaveBeenCalledWith("27604977");
    expect(insert).toHaveBeenCalled();
  });

  it("throws NotFoundException for an unknown IČO instead of caching a null", async () => {
    const select = vi.fn().mockReturnValueOnce(makeSelectChain([]));
    const { insert } = makeInsertChain();
    getSubjectByIcoMock.mockResolvedValue(null);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbService = { db: { select, insert } } as unknown as DbService;
    const service = new ContactsService(dbService);

    await expect(service.aresLookup("00000000")).rejects.toBeInstanceOf(NotFoundException);
    expect(insert).not.toHaveBeenCalled();
  });
});

const RPO_SUBJECT = { ico: "35763469", name: "Slovak Telekom, a.s.", street: "Bajkalská 28", city: "Bratislava", postalCode: "81762", terminatedAt: null };
const RPO_KOFOLA = { ico: "36319198", name: "KOFOLA a.s.", street: "Rajecká cesta", city: "Rajecká Lesná", postalCode: "01315", terminatedAt: null };

/** A service whose ares_cache is always empty, so every ARES answer comes from the mocked client. */
function serviceWithEmptyCache() {
  const { insert } = makeInsertChain();
  const select = vi.fn(() => makeSelectChain([]));
  return new ContactsService({ db: { select, insert } } as unknown as DbService);
}

describe("ContactsService registry order", () => {
  beforeEach(() => {
    for (const m of [getSubjectByIcoMock, getRpoSubjectByIcoMock, searchRpoSubjectsMock, searchSubjectsTypeaheadMock]) m.mockReset();
  });

  it("never asks RPO for an IČO that ARES knows", async () => {
    getSubjectByIcoMock.mockResolvedValue(SUBJECT);
    const service = serviceWithEmptyCache();

    const hits = await service.registrySearch("27604977", "auto", "fast");
    await service.lookupById("27604977", "CZ");

    expect(hits.map((h) => [h.legalName, h.addressCountry])).toEqual([["Novák Consulting s.r.o.", "CZ"]]);
    expect(getRpoSubjectByIcoMock).not.toHaveBeenCalled();
  });

  it("asks RPO only after ARES does not know the IČO", async () => {
    const order: string[] = [];
    getSubjectByIcoMock.mockImplementation(async () => (order.push("ARES"), null));
    getRpoSubjectByIcoMock.mockImplementation(async () => (order.push("RPO"), RPO_SUBJECT));

    const hits = await serviceWithEmptyCache().registrySearch("35763469", "auto");

    expect(order).toEqual(["ARES", "RPO"]);
    expect(hits.map((h) => h.addressCountry)).toEqual(["SK"]);
  });

  it("asks RPO first for a Slovak company and ARES only when RPO does not know it", async () => {
    getRpoSubjectByIcoMock.mockResolvedValue(RPO_SUBJECT);
    const service = serviceWithEmptyCache();
    expect((await service.lookupById("35763469", "SK")).legalName).toBe("Slovak Telekom, a.s.");
    expect((await service.registrySearch("35763469", "SK")).map((h) => h.addressCountry)).toEqual(["SK"]);
    expect(getSubjectByIcoMock).not.toHaveBeenCalled();

    const order: string[] = [];
    // An RPO outage is not cached, so a second RPO call would show up here.
    getRpoSubjectByIcoMock.mockImplementation(async () => {
      order.push("RPO");
      throw new Error("timeout");
    });
    getSubjectByIcoMock.mockImplementation(async () => (order.push("ARES"), null));
    await expect(serviceWithEmptyCache().lookupById("27604977", "SK")).rejects.toBeInstanceOf(NotFoundException);
    expect(order).toEqual(["RPO", "ARES"]);

    getRpoSubjectByIcoMock.mockResolvedValue(null);
    getSubjectByIcoMock.mockResolvedValue(SUBJECT);
    expect((await serviceWithEmptyCache().lookupById("27604977", "SK")).addressCountry).toBe("CZ");
  });

  it("remembers an RPO answer instead of asking again", async () => {
    getRpoSubjectByIcoMock.mockResolvedValue(RPO_SUBJECT);
    const service = serviceWithEmptyCache();
    await service.lookupById("35763469", "SK");
    await service.lookupById("35763469", "SK");
    expect(getRpoSubjectByIcoMock).toHaveBeenCalledTimes(1);
    expect(getRpoSubjectByIcoMock).toHaveBeenCalledWith("35763469", { timeoutMs: 12_000 });
  });

  it("splits a name search into ARES (fast) and RPO (slow) halves", async () => {
    searchSubjectsTypeaheadMock.mockResolvedValue([SUBJECT]);
    searchRpoSubjectsMock.mockResolvedValue([RPO_KOFOLA]);

    const fast = await serviceWithEmptyCache().registrySearch("kofola", "auto", "fast");
    expect(fast.map((h) => h.addressCountry)).toEqual(["CZ"]);
    expect(searchRpoSubjectsMock).not.toHaveBeenCalled();

    const slow = await serviceWithEmptyCache().registrySearch("kofola", "auto", "slow");
    expect(slow.map((h) => [h.legalName, h.addressCountry])).toEqual([["KOFOLA a.s.", "SK"]]);
    expect(searchSubjectsTypeaheadMock).toHaveBeenCalledTimes(1);
    expect(searchRpoSubjectsMock).toHaveBeenCalledWith("kofola", { limit: 3, timeoutMs: 12_000 });

    const all = await serviceWithEmptyCache().registrySearch("kofola", "auto");
    expect(all.map((h) => h.addressCountry)).toEqual(["CZ", "SK"]);
  });

  it("does not wait for RPO when only Czech companies were asked for", async () => {
    searchSubjectsTypeaheadMock.mockResolvedValue([SUBJECT]);
    const hits = await serviceWithEmptyCache().registrySearch("novák consulting", "CZ");
    expect(hits).toHaveLength(1);
    expect(searchRpoSubjectsMock).not.toHaveBeenCalled();
  });

  it("does not remember an RPO timeout as no hits", async () => {
    searchRpoSubjectsMock.mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce([RPO_KOFOLA]);
    const service = serviceWithEmptyCache();
    expect(await service.registrySearch("kofola", "auto", "slow")).toEqual([]);
    expect(await service.registrySearch("kofola", "auto", "slow")).toHaveLength(1);
    expect(await service.registrySearch("kofola", "auto", "slow")).toHaveLength(1);
    expect(searchRpoSubjectsMock).toHaveBeenCalledTimes(2);
  });
});

describe("hasSlowPart", () => {
  it("is only the Slovak name search next to ARES", () => {
    expect(hasSlowPart("kofola", "auto")).toBe(true);
    expect(hasSlowPart("kofola", "EU")).toBe(true);
    expect(hasSlowPart("CZ27604977", "auto")).toBe(true);
    expect(hasSlowPart("kofola", "CZ")).toBe(false);
    expect(hasSlowPart("kofola", "SK")).toBe(false);
    expect(hasSlowPart("ko", "auto")).toBe(false);
    expect(hasSlowPart("27604977", "auto")).toBe(false);
    expect(hasSlowPart("DE811569869", "auto")).toBe(false);
    expect(hasSlowPart("CZ27604977", "EU")).toBe(false);
  });
});
