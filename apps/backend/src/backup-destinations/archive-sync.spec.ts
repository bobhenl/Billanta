import { describe, expect, it, vi } from "vitest";
import { PLAIN, storedFingerprint, syncArchive, type ArchiveEntry, type ArchiveTransform, type TrackedFile } from "./archive-sync";

const entry = (path: string, fingerprint: string, body = path): ArchiveEntry => ({
  path,
  year: 2026,
  mime: "application/pdf",
  fingerprint,
  load: vi.fn(async () => Buffer.from(body)),
});

/** A destination in memory: what was put where, plus the tracking table. */
function destination() {
  const files = new Map<string, { data: Buffer; mime: string; remoteId: string }>();
  const tracked = new Map<string, TrackedFile>();
  const puts: { path: string; previous: string | null }[] = [];
  let ids = 0;
  const uploader = {
    put: vi.fn(async (path: string, data: Buffer, mime: string, previous: string | null) => {
      puts.push({ path, previous });
      const remoteId = previous ?? `id-${++ids}`;
      files.set(path, { data, mime, remoteId });
      return { remoteId };
    }),
  };
  // A fresh Map per run, like reloading the table from the database.
  const tracker = { record: vi.fn(async (path: string, fingerprint: string, remoteId: string | null) => void tracked.set(path, { fingerprint, remoteId })) };
  const run = (entries: ArchiveEntry[], opts: { transform?: ArchiveTransform; limit?: number } = {}) =>
    syncArchive({ entries, tracked: new Map(tracked), uploader, tracker, ...opts });
  return { files, tracked, puts, uploader, tracker, run };
}

describe("syncArchive", () => {
  it("uploads everything once, then nothing while the documents stay the same", async () => {
    const d = destination();
    const entries = [entry("Billanta/2026/vydane/1.pdf", "f1"), entry("Billanta/2026/vydane/1.isdoc", "f2")];

    expect(await d.run(entries)).toEqual({ uploaded: 2, unchanged: 0, remaining: 0, failed: [] });
    expect(d.files.get("Billanta/2026/vydane/1.pdf")?.data.toString()).toBe("Billanta/2026/vydane/1.pdf");

    const again = [entry("Billanta/2026/vydane/1.pdf", "f1"), entry("Billanta/2026/vydane/1.isdoc", "f2")];
    expect(await d.run(again)).toEqual({ uploaded: 0, unchanged: 2, remaining: 0, failed: [] });
    // Unchanged documents are not even rendered.
    expect(again[0].load).not.toHaveBeenCalled();
    expect(d.uploader.put).toHaveBeenCalledTimes(2);
  });

  it("re-uploads only a changed document, over its earlier remote file", async () => {
    const d = destination();
    await d.run([entry("a.pdf", "v1"), entry("b.pdf", "v1")]);
    const firstId = d.tracked.get("a.pdf")!.remoteId;

    const result = await d.run([entry("a.pdf", "v2", "new"), entry("b.pdf", "v1")]);
    expect(result).toMatchObject({ uploaded: 1, unchanged: 1 });
    expect(d.puts.at(-1)).toEqual({ path: "a.pdf", previous: firstId });
    expect(d.tracked.get("a.pdf")).toEqual({ fingerprint: "v2", remoteId: firstId });
    expect(d.files.get("a.pdf")?.data.toString()).toBe("new");
  });

  it("encrypts to .age files and uploads again when the key changes", async () => {
    const d = destination();
    const age = (id: string): ArchiveTransform => ({ id, suffix: ".age", apply: async (b) => Buffer.concat([Buffer.from(`${id}:`), b]) });

    await d.run([entry("a.pdf", "v1")], { transform: age("k1") });
    expect([...d.files.keys()]).toEqual(["a.pdf.age"]);
    expect(d.files.get("a.pdf.age")).toMatchObject({ mime: "application/octet-stream" });
    expect(d.files.get("a.pdf.age")?.data.toString()).toBe("k1:a.pdf");
    expect(d.tracked.get("a.pdf.age")?.fingerprint).toBe(storedFingerprint({ fingerprint: "v1" }, age("k1")));

    expect(await d.run([entry("a.pdf", "v1")], { transform: age("k1") })).toMatchObject({ uploaded: 0 });
    expect(await d.run([entry("a.pdf", "v1")], { transform: age("k2") })).toMatchObject({ uploaded: 1 });
    expect(d.files.get("a.pdf.age")?.data.toString()).toBe("k2:a.pdf");

    // Turning encryption off writes the readable file next to it.
    expect(await d.run([entry("a.pdf", "v1")], { transform: PLAIN })).toMatchObject({ uploaded: 1 });
    expect(d.files.get("a.pdf")?.mime).toBe("application/pdf");
  });

  it("stops at the per-run limit and picks the rest up next time", async () => {
    const d = destination();
    const entries = ["1", "2", "3", "4", "5"].map((n) => entry(`${n}.pdf`, n));
    expect(await d.run(entries, { limit: 2 })).toEqual({ uploaded: 2, unchanged: 0, remaining: 3, failed: [] });
    expect(await d.run(entries, { limit: 2 })).toEqual({ uploaded: 2, unchanged: 2, remaining: 1, failed: [] });
    expect(await d.run(entries, { limit: 2 })).toEqual({ uploaded: 1, unchanged: 4, remaining: 0, failed: [] });
    expect(d.files.size).toBe(5);
  });

  it("skips a document that fails to render and keeps going", async () => {
    const d = destination();
    const broken = entry("bad.pdf", "x");
    broken.load = async () => {
      throw new Error("pdf render failed");
    };
    const result = await d.run([broken, entry("ok.pdf", "y")]);
    expect(result).toEqual({ uploaded: 1, unchanged: 0, remaining: 0, failed: [{ path: "bad.pdf", error: "pdf render failed" }] });
    expect(d.tracked.has("bad.pdf")).toBe(false);
    // Not tracked, so the next run tries it again.
    expect(await d.run([entry("bad.pdf", "x"), entry("ok.pdf", "y")])).toMatchObject({ uploaded: 1, unchanged: 1 });
  });

  it("ends the run on an upload error but keeps what went up", async () => {
    const d = destination();
    d.uploader.put.mockImplementationOnce(async () => ({ remoteId: "r1" })).mockRejectedValueOnce(new Error("quota exceeded"));
    await expect(d.run([entry("a.pdf", "1"), entry("b.pdf", "2")])).rejects.toThrow("quota exceeded");
    expect([...d.tracked.keys()]).toEqual(["a.pdf"]);
  });
});
