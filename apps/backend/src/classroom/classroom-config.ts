/** Classroom mode settings (docs/classroom-mode-plan.md); read per call so tests can set them. */
export function classroomConfig() {
  const num = (name: string, fallback: number) => {
    const n = Number(process.env[name]);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    enabled: process.env.CLASSROOM_ENABLED === "true",
    // The frontend server is the only caller of the public routes, as with the demo.
    provisionSecret: process.env.DEMO_PROVISION_SECRET ?? "",
    ipSalt: process.env.DEMO_IP_SALT ?? "",
    // HMAC key of the re-entry code lookups; the codes themselves are encrypted with the backup key.
    codeSecret: process.env.CLASSROOM_CODE_SECRET ?? "",
    encryptionKey: process.env.BACKUP_CONFIG_ENCRYPTION_KEY ?? "",
    maxActiveClassesPerTeacher: num("CLASSROOM_MAX_CLASSES_PER_TEACHER", 30),
    maxStudentsPerClass: num("CLASSROOM_MAX_STUDENTS_PER_CLASS", 60),
    siteUrl: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100").replace(/\/$/, ""),
  };
}

/** The version of docs/classroom-dpa-draft.md a teacher accepts when applying. */
export const CLASSROOM_TERMS_VERSION = "classroom-dpa-0.1";

/** After the class ends its companies are read-only this long, then deleted (classroom_join). */
export const CLASSROOM_GRACE_DAYS = 30;

/**
 * A student session lasts two weeks at most, not until the class is
 * deleted: school computers are shared, and the personal code brings the
 * student back in. Covers a weekly lesson with one to spare.
 */
export const STUDENT_SESSION_DAYS = 14;

export function studentSessionEnd(companyExpiresAt: Date, now = Date.now()): string {
  return new Date(Math.min(new Date(companyExpiresAt).getTime(), now + STUDENT_SESSION_DAYS * 86_400_000)).toISOString();
}
