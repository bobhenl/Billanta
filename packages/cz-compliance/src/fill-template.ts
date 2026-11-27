/**
 * Fills `{name}` placeholders from `values`; unknown ones stay as typed, so
 * a customer's own braces survive. Shared by e-mails and PDFs (server and
 * browser alike).
 */
export function fillTemplate(template: string, values: Partial<Record<string, string>>): string {
  return template.replace(/\{([a-z_][a-z0-9_]*)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? (values as Record<string, string>)[key] ?? '' : match,
  );
}
