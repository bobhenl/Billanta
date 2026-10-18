import { DEMO_KINDS, type DemoKind } from "../demo/dataset";
import type { AppModule } from "../tenants/modules";

/** How far a class goes; picked per class, the school level only suggests one. */
export const CLASSROOM_TRACKS = ["basic", "standard", "advanced"] as const;
export type ClassroomTrack = (typeof CLASSROOM_TRACKS)[number];

export const SCHOOL_LEVELS = ["zs", "ss", "vos", "vs", "course"] as const;
export type SchoolLevel = (typeof SCHOOL_LEVELS)[number];

export function isClassroomTrack(value: unknown): value is ClassroomTrack {
  return typeof value === "string" && (CLASSROOM_TRACKS as readonly string[]).includes(value);
}

export function suggestedTrack(level: SchoolLevel): ClassroomTrack {
  if (level === "zs") return "basic";
  if (level === "vs") return "advanced";
  return "standard";
}

/**
 * The parts of the dashboard a track shows. Basic is the first invoice and
 * contacts; standard adds what a business school teaches (VAT documents,
 * bank, expenses, quotes); advanced has everything, with the VAT reports.
 * AI is off in every class: a student's work is their own.
 */
const TRACK_MODULES: Record<ClassroomTrack, Record<AppModule, boolean>> = {
  basic: { expenses: false, bank: false, recurring: false, quotes: false, reports: false, ai: false, time: false },
  standard: { expenses: true, bank: true, recurring: false, quotes: true, reports: false, ai: false, time: false },
  advanced: { expenses: true, bank: true, recurring: true, quotes: true, reports: true, ai: false, time: true },
};

export function trackModules(track: ClassroomTrack): Record<AppModule, boolean> {
  return { ...TRACK_MODULES[track] };
}

/** A teacher's own module choice, with AI forced off whatever they sent. */
export function classModules(track: ClassroomTrack, overrides?: Partial<Record<AppModule, boolean>>): Record<AppModule, boolean> {
  return { ...TRACK_MODULES[track], ...(overrides ?? {}), ai: false };
}

/** Which practice companies students may pick. Basic stays without VAT. */
export function trackKinds(track: ClassroomTrack, country: "CZ" | "SK"): DemoKind[] {
  if (track === "basic") return ["cz_freelancer", "cz_pausal"];
  if (track === "standard") return country === "SK" ? ["sk_vat_sro", "cz_vat_sro"] : ["cz_vat_sro", "cz_freelancer"];
  return [...DEMO_KINDS];
}

/** The teacher's pick, limited to real kinds and never empty. */
export function classKinds(track: ClassroomTrack, country: "CZ" | "SK", requested?: unknown): DemoKind[] {
  if (!Array.isArray(requested)) return trackKinds(track, country);
  const picked = DEMO_KINDS.filter((k) => requested.includes(k));
  return picked.length ? picked : trackKinds(track, country);
}
