import { describe, expect, it } from "vitest";
import { compare, datasetDates, LEGISLATION_SOURCES, relevantPart } from "./sources";

const epo = LEGISLATION_SOURCES.find((s) => s.key === "epo_forms")!;
const page = (rows: string) =>
  `<html><head><script>var t = Date.now();</script></head><body><nav>Menu ${Math.random()}</nav><table>${rows}</table></body></html>`;
const ROWS = `<tr><td>DPHDP3</td><td>Přiznání k dani z přidané hodnoty</td><td>03.01.04</td><td>11.8.2026</td></tr>
<tr><td>DPFDP7</td><td>Daň z příjmů fyzických osob - od roku 2024 včetně</td><td>01.01.02</td><td>23.9.2025</td></tr>`;

describe("legislation sources", () => {
  it("keeps only form codes with versions from the EPO list", () => {
    expect(relevantPart(epo, page(ROWS))).toBe(
      "DPHDP3 Přiznání k dani z přidané hodnoty 03.01.04\nDPFDP7 Daň z příjmů fyzických osob - od roku 2024 včetně 01.01.02",
    );
  });

  it("ignores changes outside the relevant part, flags a new version", () => {
    const first = compare(epo, page(ROWS), null);
    expect(first.status).toBe("baseline");
    const hash = first.status === "error" ? "" : first.hash;
    expect(compare(epo, page(ROWS), hash).status).toBe("unchanged");
    expect(compare(epo, page(ROWS.replace("03.01.04", "03.01.05")), hash).status).toBe("changed");
    // A new form (DPFDP8) is a change too.
    expect(compare(epo, page(ROWS + "<tr><td>DPFDP8</td><td>Daň z příjmů</td><td>01.01.01</td></tr>"), hash).status).toBe("changed");
  });

  it("reports a page that lost its relevant part as an error, not as unchanged", () => {
    expect(compare(epo, "<html><body>Údržba systému</body></html>", "abc")).toEqual({ status: "error", error: "relevant_part_not_found" });
  });

  it("dates a dataset by its least recently confirmed source", () => {
    const at = (d: string) => new Date(`${d}T03:00:00Z`);
    const all = LEGISLATION_SOURCES.map((s) => ({ key: s.key, confirmedAt: at("2026-10-12") }));
    const dates = datasetDates(all.map((r) => (r.key === "fs_press" ? { ...r, confirmedAt: at("2026-10-05") } : r)));
    expect(dates.vat_forms).toBe("2026-10-12");
    // fs_press feeds both flat_tax and osvc_minimums.
    expect(dates.flat_tax).toBe("2026-10-05");
    expect(dates.osvc_minimums).toBe("2026-10-05");
    expect(datasetDates(all.filter((r) => r.key !== "cssz_osvc_schema")).cssz_form).toBeNull();
  });
});
