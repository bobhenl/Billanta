/** Mailbox providers anyone can sign up at: an address there proves nothing about a school. */
const FREEMAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "seznam.cz",
  "email.cz",
  "post.cz",
  "centrum.cz",
  "atlas.cz",
  "volny.cz",
  "tiscali.cz",
  "azet.sk",
  "zoznam.sk",
  "centrum.sk",
  "pobox.sk",
  "post.sk",
  "atlas.sk",
]);

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) ? domain : null;
}

export function isFreemail(domain: string): boolean {
  return FREEMAIL.has(domain.toLowerCase());
}

/** The school's own domain from its web address ("https://www.oa-praha.cz/" → "oa-praha.cz"). */
export function domainFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase();
    const domain = host.replace(/^www\./, "");
    return domain.includes(".") && !isFreemail(domain) ? domain : null;
  } catch {
    return null;
  }
}

/**
 * Whether a verified address belongs to the school's domain, its
 * subdomains included (`novak@zak.oa-praha.cz` is not a teacher, but staff
 * check those by hand anyway; the fast path only needs "is at the school").
 */
export function onSchoolDomain(email: string, schoolDomain: string | null): boolean {
  if (!schoolDomain || isFreemail(schoolDomain)) return false;
  const domain = emailDomain(email);
  if (!domain) return false;
  const school = schoolDomain.toLowerCase();
  return domain === school || domain.endsWith(`.${school}`);
}
