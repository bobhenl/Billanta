import { describe, expect, it } from "vitest";
import { checkSamples, errorPath, nextFormState, type FormSchemaRow, type SchemaOutcome } from "./form-schema-check";

const xsd = (maxLength: number) =>
  `<?xml version="1.0"?><xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="Pisemnost"><xs:complexType>` +
  `<xs:attribute name="c_telef"><xs:simpleType><xs:restriction base="xs:string"><xs:maxLength value="${maxLength}"/></xs:restriction></xs:simpleType></xs:attribute>` +
  `</xs:complexType></xs:element></xs:schema>`;
const sample = { form: "dphdp3", name: "DPHDP3 sample", xml: '<Pisemnost c_telef="+420600000000" />' };

const URL = "https://adisspr.mfcr.cz/adis/jepo/schema/dphdp3_epo2.xsd";
const NOW = new Date("2026-12-01T04:15:00Z");
const row = (o: Partial<FormSchemaRow> = {}): FormSchemaRow => ({
  form: "dphdp3",
  url: URL,
  hash: "h1",
  xsd: "<xs:schema/>",
  status: "ok",
  errors: null,
  lastError: null,
  lastCheckedAt: new Date("2026-11-30T04:15:00Z"),
  lastChangedAt: null,
  blockedAt: null,
  ...o,
});
const passed = (hash = "h1"): SchemaOutcome => ({ kind: "checked", xsd: "<xs:schema/>", hash, valid: true, errors: [] });
const failed = (hash = "h2"): SchemaOutcome => ({ kind: "checked", xsd: "<xs:schema/>", hash, valid: false, errors: ["DPHDP3 sample: too long"] });
const kinds = (r: { alerts: { kind: string }[] }) => r.alerts.map((a) => a.kind);

describe("checkSamples", () => {
  it("passes samples the XSD accepts and fails the ones it does not", async () => {
    expect(await checkSamples(xsd(14), [sample])).toMatchObject({ kind: "checked", valid: true, errors: [] });
    const out = await checkSamples(xsd(10), [sample]);
    expect(out).toMatchObject({ kind: "checked", valid: false });
    expect(out.kind === "checked" && out.errors[0]).toMatch(/^DPHDP3 sample: .*c_telef/);
  });

  it("never blocks on something that is not an EPO schema", async () => {
    expect(await checkSamples("<html><body>Údržba systému</body></html>", [sample])).toEqual({ kind: "unavailable", error: "not_an_epo_schema" });
    // Looks like one but libxml cannot compile it.
    const broken = xsd(14).replace('base="xs:string"', 'base="xs:nonsense"');
    expect(await checkSamples(broken, [sample])).toEqual({ kind: "unavailable", error: "schema_unusable" });
  });

  it("hashes the schema, so the same XSD is the same hash", async () => {
    const a = await checkSamples(xsd(14), [sample]);
    const b = await checkSamples(xsd(14), [sample]);
    const c = await checkSamples(xsd(15), [sample]);
    expect(a.kind === "checked" && b.kind === "checked" && c.kind === "checked").toBe(true);
    if (a.kind !== "checked" || b.kind !== "checked" || c.kind !== "checked") return;
    expect(a.hash).toBe(b.hash);
    expect(a.hash).not.toBe(c.hash);
  });
});

describe("errorPath", () => {
  it("keeps the element, attribute and rule but never the value", () => {
    const msg = "Schemas validity error : Element 'VetaP', attribute 'c_telef': [facet 'maxLength'] The value '+420 777 123 456' has a length of '16'; this exceeds the allowed maximum length of '14'.";
    expect(errorPath(msg)).toBe("VetaP/@c_telef: maxLength");
    expect(errorPath("Element 'VetaP', attribute 'email': The attribute 'email' is not allowed.")).toBe("VetaP/@email: not allowed");
    expect(errorPath("Element 'Veta9': This element is not expected.")).toBe("Veta9: structure");
    expect(errorPath("something else 'jan@example.cz'")).toBe("document: invalid");
  });
});

describe("nextFormState", () => {
  it("takes the first XSD as the baseline without an alert", () => {
    const r = nextFormState("dphdp3", URL, null, passed(), NOW);
    expect(r.row).toMatchObject({ status: "ok", hash: "h1", lastCheckedAt: NOW, lastChangedAt: null });
    expect(r.alerts).toEqual([]);
  });

  it("stays quiet while nothing changes", () => {
    expect(nextFormState("dphdp3", URL, row(), passed(), NOW).alerts).toEqual([]);
  });

  it("only informs about a changed XSD our samples still pass", () => {
    const r = nextFormState("dphdp3", URL, row(), passed("h2"), NOW);
    expect(r.row).toMatchObject({ status: "ok", hash: "h2", lastChangedAt: NOW });
    expect(kinds(r)).toEqual(["form_schema_changed"]);
  });

  it("blocks the form once the samples fail, and alerts once per streak", () => {
    const first = nextFormState("dphdp3", URL, row(), failed(), NOW);
    expect(first.row).toMatchObject({ status: "blocked", blockedAt: NOW, errors: "DPHDP3 sample: too long" });
    expect(kinds(first)).toEqual(["form_schema_blocked"]);
    const later = new Date("2026-12-02T04:15:00Z");
    const again = nextFormState("dphdp3", URL, first.row, failed(), later);
    expect(again.row).toMatchObject({ status: "blocked", blockedAt: NOW, lastCheckedAt: later });
    expect(again.alerts).toEqual([]);
  });

  it("unblocks when a fixed generator passes again", () => {
    const r = nextFormState("dphdp3", URL, row({ status: "blocked", blockedAt: NOW, errors: "x", hash: "h2" }), passed("h2"), NOW);
    expect(r.row).toMatchObject({ status: "ok", blockedAt: null, errors: null });
    expect(kinds(r)).toEqual(["form_schema_unblocked"]);
  });

  it("keeps the last verdict when the XSD cannot be fetched: an outage neither blocks nor unblocks", () => {
    const down: SchemaOutcome = { kind: "unavailable", error: "timeout" };
    const ok = nextFormState("dphdp3", URL, row(), down, NOW);
    expect(ok.row).toMatchObject({ status: "ok", hash: "h1", lastError: "timeout" });
    expect(kinds(ok)).toEqual(["form_schema_check_failed"]);
    const blocked = nextFormState("dphdp3", URL, row({ status: "blocked", blockedAt: NOW }), down, NOW);
    expect(blocked.row.status).toBe("blocked");
    // The next failure of the same streak is quiet.
    expect(nextFormState("dphdp3", URL, ok.row, down, NOW).alerts).toEqual([]);
    // A success ends the streak.
    expect(nextFormState("dphdp3", URL, ok.row, passed(), NOW).row.lastError).toBeNull();
  });
});
