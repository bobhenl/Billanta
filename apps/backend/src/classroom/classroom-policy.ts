export type ClassroomBlockCode = "classroom_disabled" | "classroom_ended";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const DISABLED: Array<{ method: string | null; pattern: RegExp }> = [
  // The demo's own extras (roles, moving to a real account) are not for students.
  { method: null, pattern: /^v1\/demo(\/.*)?$/ },
  // The client portal invites a real person by e-mail.
  { method: null, pattern: /^v1\/contacts\/[^/]+\/portal(\/.*)?$/ },
];

/**
 * What a practice company may do on top of the demo rules (`demoBlockFor`,
 * which runs first). Exports stay open like in the demo: the VAT returns
 * are a lesson of their own. After the class ends the company is read-only
 * until it is deleted, so students can still look and download.
 */
export function classroomBlockFor(method: string, path: string, readOnly: boolean): ClassroomBlockCode | null {
  const m = method.toUpperCase();
  if (DISABLED.some((r) => (r.method === null || r.method === m) && r.pattern.test(path))) return "classroom_disabled";
  if (readOnly && !SAFE_METHODS.has(m)) return "classroom_ended";
  return null;
}
