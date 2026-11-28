/**
 * `X-Schema-Problems` (URI-encoded JSON list of value-free paths such as
 * "VetaP/@c_telef: maxLength"): where an export fails the form's official
 * XSD, as the backend's daily form check stored it (form-schemas.service.ts).
 */
export function schemaProblems(header: string | null): string[] {
  if (!header) return [];
  try {
    const list = JSON.parse(decodeURIComponent(header)) as unknown;
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    // A malformed header must not stop the download.
    return [];
  }
}
