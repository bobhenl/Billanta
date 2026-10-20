/**
 * Mailbox providers anyone can sign up at: an address there proves nothing
 * about a school, so such a domain is never trusted as a school's.
 */
const FREEMAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "passport.com",
  "yahoo.com",
  "ymail.com",
  "rocketmail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "aim.com",
  "mail.com",
  "email.com",
  "usa.com",
  "web.de",
  "t-online.de",
  "freenet.de",
  "mail.ru",
  "inbox.ru",
  "list.ru",
  "bk.ru",
  "ya.ru",
  "zoho.com",
  "zohomail.com",
  "zohomail.eu",
  "proton.me",
  "protonmail.com",
  "protonmail.ch",
  "pm.me",
  "tutanota.com",
  "tutanota.de",
  "tutamail.com",
  "tuta.io",
  "tuta.com",
  "keemail.me",
  "fastmail.com",
  "hey.com",
  "mailbox.org",
  "posteo.de",
  "disroot.org",
  "o2.pl",
  "wp.pl",
  "onet.pl",
  "interia.pl",
  "seznam.cz",
  "email.cz",
  "post.cz",
  "centrum.cz",
  "atlas.cz",
  "volny.cz",
  "tiscali.cz",
  "quick.cz",
  "iol.cz",
  "azet.sk",
  "zoznam.sk",
  "centrum.sk",
  "pobox.sk",
  "post.sk",
  "atlas.sk",
  "inmail.sk",
  "szm.sk",
  "orangemail.sk",
  "stonline.sk",
]);

/**
 * Providers that run the same free service under many country domains
 * (gmx.de, gmx.at, yahoo.co.uk, hotmail.cz): any TLD, one or two labels.
 */
const FREEMAIL_FAMILIES = new Set(["gmx", "yandex", "yahoo", "outlook", "hotmail", "live", "windowslive", "aol", "icloud"]);

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
  const d = domain.trim().toLowerCase().replace(/\.$/, "");
  if (FREEMAIL.has(d)) return true;
  const family = /^([a-z0-9-]+)\.(?:[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/.exec(d);
  return family !== null && FREEMAIL_FAMILIES.has(family[1]);
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
