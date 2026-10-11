import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbService } from "../db/db.service";
import { ContactsService } from "./contacts.service";

const { getSubjectByIcoMock } = vi.hoisted(() => ({ getSubjectByIcoMock: vi.fn() }));

vi.mock("@faktur/cz-compliance", () => ({
  getSubjectByIco: getSubjectByIcoMock,
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
