import { createHash } from "node:crypto";
import { validateXML } from "xmllint-wasm";
import type { EpoSchemaSample } from "@faktur/cz-compliance";

export type FormSchemaRow = {
  form: string;
  url: string;
  hash: string | null;
  xsd: string | null;
  status: "ok" | "blocked";
  errors: string | null;
  lastError: string | null;
  lastCheckedAt: Date | null;
  lastChangedAt: Date | null;
  blockedAt: Date | null;
};

/** What one morning's check found for a form. */
export type SchemaOutcome =
  | { kind: "unavailable"; error: string }
  | { kind: "checked"; xsd: string; hash: string; valid: boolean; errors: string[] };

export type SchemaAlert = { kind: "form_schema_changed" | "form_schema_blocked" | "form_schema_unblocked" | "form_schema_check_failed"; message: string };

const XSD_NAME = "form.xsd";

/**
 * A page that is not an EPO schema (an error page served with 200, a moved
 * URL) must not block a form: only a real schema that our samples fail does.
 */
export function looksLikeEpoSchema(text: string): boolean {
  return /<xs:schema[\s>]/.test(text) && /<xs:element[^>]*name="Pisemnost"/.test(text);
}

export const xsdHash = (xsd: string) => createHash("sha256").update(xsd).digest("hex");

export interface XsdResult {
  valid: boolean;
  /** True when libxml could not use the schema itself. */
  schemaBroken: boolean;
  errors: { message: string; path: string }[];
}

/**
 * libxml2's verdict on one document. `path` names the element, attribute
 * and failed rule without the value ("VetaP/@c_telef: maxLength"), so it
 * can be logged or shown for a person's own export; `message` may quote
 * the value and is only for our fictitious samples.
 */
export async function validateAgainstXsd(xsd: string, xml: string): Promise<XsdResult> {
  let r: Awaited<ReturnType<typeof validateXML>>;
  try {
    r = await validateXML({ xml: [{ fileName: "export.xml", contents: xml }], schema: [{ fileName: XSD_NAME, contents: xsd }] });
  } catch {
    // xmllint-wasm rejects (instead of reporting) when it cannot compile the schema.
    return { valid: false, schemaBroken: true, errors: [] };
  }
  const errors = r.errors.map((e) => ({ message: e.message, path: errorPath(e.message) }));
  const schemaBroken = r.errors.some((e) => e.loc?.fileName === XSD_NAME || /Schemas parser error|failed to compile/i.test(e.rawMessage));
  return { valid: r.valid, schemaBroken, errors };
}

export function errorPath(message: string): string {
  const el = /Element '([^']+)'/.exec(message)?.[1];
  const attr = /attribute '([^']+)'/.exec(message)?.[1];
  const facet = /\[facet '([^']+)'\]/.exec(message)?.[1];
  const rule = facet ?? (/not allowed/.test(message) ? "not allowed" : /missing|expected/.test(message) ? "structure" : /not a valid value/.test(message) ? "type" : "invalid");
  if (!el) return "document: invalid";
  return `${el}${attr ? `/@${attr}` : ""}: ${rule}`;
}

/** Fetched XSD → outcome: the samples of this form all pass, or which of them fail. */
export async function checkSamples(xsd: string, samples: EpoSchemaSample[]): Promise<SchemaOutcome> {
  if (!looksLikeEpoSchema(xsd)) return { kind: "unavailable", error: "not_an_epo_schema" };
  const errors: string[] = [];
  for (const s of samples) {
    const r = await validateAgainstXsd(xsd, s.xml);
    if (r.schemaBroken) return { kind: "unavailable", error: "schema_unusable" };
    // Samples carry only fictitious data, so the full message is safe to keep.
    for (const e of r.errors.slice(0, 5)) errors.push(`${s.name}: ${e.message}`);
  }
  return { kind: "checked", xsd, hash: xsdHash(xsd), valid: errors.length === 0, errors };
}

/**
 * The next state of a form and the alerts to raise. Nothing here changes a
 * generator: a failing form is blocked until a fixed release passes again.
 * A form we could not check keeps its last verdict, so an outage neither
 * blocks nor unblocks anything. One alert per streak, not one per day.
 */
export function nextFormState(
  form: string,
  url: string,
  prev: FormSchemaRow | null,
  outcome: SchemaOutcome,
  now: Date,
): { row: FormSchemaRow; alerts: SchemaAlert[] } {
  const label = form.toUpperCase();
  if (outcome.kind === "unavailable") {
    const row: FormSchemaRow = prev
      ? { ...prev, lastError: outcome.error, lastCheckedAt: now }
      : { form, url, hash: null, xsd: null, status: "ok", errors: null, lastError: outcome.error, lastCheckedAt: now, lastChangedAt: null, blockedAt: null };
    const alerts: SchemaAlert[] = prev?.lastError
      ? []
      : [{ kind: "form_schema_check_failed", message: `${label}: the XSD could not be checked (${outcome.error}), the form keeps its last state. ${url}` }];
    return { row, alerts };
  }

  const changed = prev?.hash != null && prev.hash !== outcome.hash;
  const row: FormSchemaRow = {
    form,
    url,
    hash: outcome.hash,
    xsd: outcome.xsd,
    status: outcome.valid ? "ok" : "blocked",
    errors: outcome.valid ? null : outcome.errors.join("\n").slice(0, 4000),
    lastError: null,
    lastCheckedAt: now,
    lastChangedAt: changed ? now : (prev?.lastChangedAt ?? null),
    blockedAt: outcome.valid ? null : (prev?.status === "blocked" ? prev.blockedAt : now),
  };
  const alerts: SchemaAlert[] = [];
  if (!outcome.valid && prev?.status !== "blocked") {
    alerts.push({
      kind: "form_schema_blocked",
      message: `${label} is blocked: our sample exports fail the current XSD (${url}). Export is refused until the generator is fixed.\n${outcome.errors.slice(0, 10).join("\n")}`,
    });
  } else if (outcome.valid && prev?.status === "blocked") {
    alerts.push({ kind: "form_schema_unblocked", message: `${label} passes the XSD again and is unblocked.` });
  } else if (outcome.valid && changed) {
    alerts.push({ kind: "form_schema_changed", message: `${label}: the XSD changed (${url}). Our exports still pass it; review the change for new or changed fields.` });
  }
  return { row, alerts };
}
