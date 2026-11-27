/**
 * PSD2 consent runs out after 90–180 days and the bank then stops sending
 * payments until someone renews it. A notice after the fact means a gap in
 * matching, so the daily sweep (`ConsentExpiryCron`) warns a week ahead and
 * again on the last day. `bank_connections.consent_warned_days` remembers the
 * smallest threshold already sent, which keeps each warning to one per
 * connection; renewing the consent clears it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days before expiry at which a warning goes out, largest first. */
export const CONSENT_WARNING_DAYS = [7, 1] as const;
export type ConsentWarningDays = (typeof CONSENT_WARNING_DAYS)[number];

export interface ConsentWarningCandidate {
  provider: string;
  status: string;
  enabled: boolean;
  consentExpiresAt: Date | null;
  consentWarnedDays: number | null;
}

/**
 * The warning this connection is due now, or null. Only the most urgent
 * threshold is returned: a consent found with half a day left gets the
 * last-day warning alone, not both at once.
 */
export function consentWarningDue(c: ConsentWarningCandidate, now: Date): ConsentWarningDays | null {
  if (c.provider !== "enable_banking" || c.status !== "active" || !c.enabled || !c.consentExpiresAt) return null;
  const left = c.consentExpiresAt.getTime() - now.getTime();
  // Already expired: the hourly sync marks it and sends the "expired" notice instead.
  if (left <= 0) return null;
  let due: ConsentWarningDays | null = null;
  for (const days of CONSENT_WARNING_DAYS) {
    if (left <= days * DAY_MS) due = days;
  }
  if (due === null) return null;
  if (c.consentWarnedDays !== null && c.consentWarnedDays <= due) return null;
  return due;
}

/** Locales the notice texts exist in; the same list the frontend routes. */
export const NOTICE_LOCALES = ["cs", "sk", "en", "de", "pl", "uk", "hu", "ro", "fr", "es", "it", "nl", "pt"] as const;
export type NoticeLocale = (typeof NOTICE_LOCALES)[number];

/** The company's default locale; a missing one means a Czech company, an unknown one reads English. */
export function noticeLocaleOf(value: string | null | undefined): NoticeLocale {
  const code = value?.trim().slice(0, 2).toLowerCase();
  if (!code) return "cs";
  return (NOTICE_LOCALES as readonly string[]).includes(code) ? (code as NoticeLocale) : "en";
}

interface NoticeTexts {
  bank: string;
  soonTitle: Record<ConsentWarningDays, string>;
  soonBody: (account: string, date: string) => string;
  expiredTitle: string;
  expiredBody: (account: string) => string;
}

const TEXTS: Record<NoticeLocale, NoticeTexts> = {
  cs: {
    bank: "Banka",
    soonTitle: { 7: "Přístup k bankovnímu účtu vyprší do týdne", 1: "Přístup k bankovnímu účtu vyprší do 24 hodin" },
    soonBody: (a, d) => `${a}: souhlas s přístupem k účtu platí do ${d}. Obnovte ho včas, ať se platby dál párují samy.`,
    expiredTitle: "Souhlas s přístupem k účtu vypršel",
    expiredBody: (a) => `${a}: obnovte napojení, ať se platby dál párují samy.`,
  },
  sk: {
    bank: "Banka",
    soonTitle: { 7: "Prístup k bankovému účtu vyprší do týždňa", 1: "Prístup k bankovému účtu vyprší do 24 hodín" },
    soonBody: (a, d) => `${a}: súhlas s prístupom k účtu platí do ${d}. Obnovte ho včas, aby sa platby naďalej párovali samy.`,
    expiredTitle: "Súhlas s prístupom k účtu vypršal",
    expiredBody: (a) => `${a}: obnovte pripojenie, aby sa platby naďalej párovali samy.`,
  },
  en: {
    bank: "Bank",
    soonTitle: { 7: "Bank account access expires within a week", 1: "Bank account access expires within 24 hours" },
    soonBody: (a, d) => `${a}: your consent to access the account is valid until ${d}. Renew it in time so payments keep matching automatically.`,
    expiredTitle: "Bank account access has expired",
    expiredBody: (a) => `${a}: reconnect the account so payments keep matching automatically.`,
  },
  de: {
    bank: "Bank",
    soonTitle: { 7: "Der Kontozugriff läuft innerhalb einer Woche ab", 1: "Der Kontozugriff läuft innerhalb von 24 Stunden ab" },
    soonBody: (a, d) =>
      `${a}: Ihre Zustimmung zum Kontozugriff gilt bis ${d}. Erneuern Sie sie rechtzeitig, damit Zahlungen weiterhin automatisch zugeordnet werden.`,
    expiredTitle: "Der Kontozugriff ist abgelaufen",
    expiredBody: (a) => `${a}: Verbinden Sie das Konto erneut, damit Zahlungen weiterhin automatisch zugeordnet werden.`,
  },
  pl: {
    bank: "Bank",
    soonTitle: { 7: "Dostęp do konta bankowego wygaśnie w ciągu tygodnia", 1: "Dostęp do konta bankowego wygaśnie w ciągu 24 godzin" },
    soonBody: (a, d) => `${a}: zgoda na dostęp do konta jest ważna do ${d}. Odnów ją na czas, aby płatności nadal dopasowywały się automatycznie.`,
    expiredTitle: "Dostęp do konta bankowego wygasł",
    expiredBody: (a) => `${a}: połącz konto ponownie, aby płatności nadal dopasowywały się automatycznie.`,
  },
  uk: {
    bank: "Банк",
    soonTitle: { 7: "Доступ до банківського рахунку спливає протягом тижня", 1: "Доступ до банківського рахунку спливає протягом 24 годин" },
    soonBody: (a, d) => `${a}: згода на доступ до рахунку діє до ${d}. Поновіть її вчасно, щоб платежі й надалі зіставлялися автоматично.`,
    expiredTitle: "Доступ до банківського рахунку закінчився",
    expiredBody: (a) => `${a}: підключіть рахунок знову, щоб платежі й надалі зіставлялися автоматично.`,
  },
  hu: {
    bank: "Bank",
    soonTitle: { 7: "A bankszámla-hozzáférés egy héten belül lejár", 1: "A bankszámla-hozzáférés 24 órán belül lejár" },
    soonBody: (a, d) =>
      `${a}: a számlához való hozzáférés engedélye eddig érvényes: ${d}. Újítsa meg időben, hogy a fizetések továbbra is automatikusan párosuljanak.`,
    expiredTitle: "A bankszámla-hozzáférés lejárt",
    expiredBody: (a) => `${a}: csatlakoztassa újra a számlát, hogy a fizetések továbbra is automatikusan párosuljanak.`,
  },
  ro: {
    bank: "Bancă",
    soonTitle: { 7: "Accesul la contul bancar expiră în mai puțin de o săptămână", 1: "Accesul la contul bancar expiră în mai puțin de 24 de ore" },
    soonBody: (a, d) =>
      `${a}: consimțământul pentru accesul la cont este valabil până la ${d}. Reînnoiți-l din timp, ca plățile să fie asociate în continuare automat.`,
    expiredTitle: "Accesul la contul bancar a expirat",
    expiredBody: (a) => `${a}: reconectați contul, ca plățile să fie asociate în continuare automat.`,
  },
  fr: {
    bank: "Banque",
    soonTitle: { 7: "L’accès au compte bancaire expire dans moins d’une semaine", 1: "L’accès au compte bancaire expire dans moins de 24 heures" },
    soonBody: (a, d) =>
      `${a} : votre consentement d’accès au compte est valable jusqu’au ${d}. Renouvelez-le à temps pour que les paiements restent rapprochés automatiquement.`,
    expiredTitle: "L’accès au compte bancaire a expiré",
    expiredBody: (a) => `${a} : reconnectez le compte pour que les paiements restent rapprochés automatiquement.`,
  },
  es: {
    bank: "Banco",
    soonTitle: { 7: "El acceso a la cuenta bancaria caduca en menos de una semana", 1: "El acceso a la cuenta bancaria caduca en menos de 24 horas" },
    soonBody: (a, d) =>
      `${a}: su consentimiento de acceso a la cuenta es válido hasta el ${d}. Renuévelo a tiempo para que los pagos se sigan conciliando automáticamente.`,
    expiredTitle: "El acceso a la cuenta bancaria ha caducado",
    expiredBody: (a) => `${a}: vuelva a conectar la cuenta para que los pagos se sigan conciliando automáticamente.`,
  },
  it: {
    bank: "Banca",
    soonTitle: { 7: "L’accesso al conto bancario scade entro una settimana", 1: "L’accesso al conto bancario scade entro 24 ore" },
    soonBody: (a, d) =>
      `${a}: il consenso all’accesso al conto è valido fino al ${d}. Lo rinnovi per tempo, così i pagamenti continuano a essere abbinati automaticamente.`,
    expiredTitle: "L’accesso al conto bancario è scaduto",
    expiredBody: (a) => `${a}: ricolleghi il conto, così i pagamenti continuano a essere abbinati automaticamente.`,
  },
  nl: {
    bank: "Bank",
    soonTitle: { 7: "Toegang tot je bankrekening verloopt binnen een week", 1: "Toegang tot je bankrekening verloopt binnen 24 uur" },
    soonBody: (a, d) =>
      `${a}: je toestemming voor toegang tot de rekening is geldig tot ${d}. Vernieuw die op tijd, zodat betalingen automatisch gekoppeld blijven.`,
    expiredTitle: "Toegang tot je bankrekening is verlopen",
    expiredBody: (a) => `${a}: koppel de rekening opnieuw, zodat betalingen automatisch gekoppeld blijven.`,
  },
  pt: {
    bank: "Banco",
    soonTitle: { 7: "O acesso à conta bancária expira dentro de uma semana", 1: "O acesso à conta bancária expira dentro de 24 horas" },
    soonBody: (a, d) =>
      `${a}: o seu consentimento de acesso à conta é válido até ${d}. Renove-o a tempo para que os pagamentos continuem a ser associados automaticamente.`,
    expiredTitle: "O acesso à conta bancária expirou",
    expiredBody: (a) => `${a}: volte a ligar a conta para que os pagamentos continuem a ser associados automaticamente.`,
  },
};

/** Intl tags for the expiry date, so "4. 12. 2026" reads naturally in each language. */
const DATE_LOCALE: Record<NoticeLocale, string> = {
  cs: "cs-CZ",
  sk: "sk-SK",
  en: "en-GB",
  de: "de-DE",
  pl: "pl-PL",
  uk: "uk-UA",
  hu: "hu-HU",
  ro: "ro-RO",
  fr: "fr-FR",
  es: "es-ES",
  it: "it-IT",
  nl: "nl-NL",
  pt: "pt-PT",
};

export interface ConsentAccount {
  bankName: string | null;
  accountNumber: string | null;
}

function accountLabel(t: NoticeTexts, c: ConsentAccount): string {
  return `${c.bankName ?? t.bank} ${c.accountNumber ?? ""}`.replace(/\s+/g, " ").trim();
}

export interface ConsentNotice {
  title: string;
  body: string;
  link: string;
}

/** The "expires soon" notice; the time matters on the last day, so it is part of the date. */
export function consentExpiringNotice(locale: NoticeLocale, days: ConsentWarningDays, c: ConsentAccount & { consentExpiresAt: Date }): ConsentNotice {
  const t = TEXTS[locale];
  const date = c.consentExpiresAt.toLocaleString(DATE_LOCALE[locale], {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Prague",
  });
  return { title: t.soonTitle[days], body: t.soonBody(accountLabel(t, c), date), link: "/bank" };
}

export function consentExpiredNotice(locale: NoticeLocale, c: ConsentAccount): ConsentNotice {
  const t = TEXTS[locale];
  return { title: t.expiredTitle, body: t.expiredBody(accountLabel(t, c)), link: "/bank" };
}
