/**
 * The quarterly "download your document archive" notice, kept pure so the
 * timing is tested on its own (`archive-reminder.spec.ts`). Quarters are
 * counted in Prague time, like the tax periods the archive is kept for.
 */

/** year * 4 + quarter index (0–3), in Europe/Prague. */
export function pragueQuarter(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit" }).formatToParts(d);
  const year = Number(parts.find((p) => p.type === "year")!.value);
  const month = Number(parts.find((p) => p.type === "month")!.value);
  return year * 4 + Math.floor((month - 1) / 3);
}

/** A destination that keeps the archive up to date without anyone clicking. */
export function isAutomaticArchive(d: { type: string; schedule: string; isActive: boolean; archiveDocuments: boolean }): boolean {
  return d.isActive && d.archiveDocuments && (d.type === "sftp" || d.type === "google_drive") && d.schedule !== "manual";
}

/**
 * Due once per quarter: the last reminder (or, before the first one, the
 * signup) is from an earlier quarter. A company that signed up this quarter
 * waits for the next one, and one with nothing to archive is left alone.
 */
export function archiveReminderDue(opts: {
  now: Date;
  remindedAt: Date | null;
  createdAt: Date;
  hasAutomaticArchive: boolean;
  hasDocuments: boolean;
}): boolean {
  if (opts.hasAutomaticArchive || !opts.hasDocuments) return false;
  return pragueQuarter(opts.remindedAt ?? opts.createdAt) < pragueQuarter(opts.now);
}

type Lang = "cs" | "sk" | "en";

export function archiveReminderMessage(locale: string | null | undefined) {
  const lang: Lang = locale === "sk" || locale === "en" ? locale : "cs";
  const link = "/settings/backup";
  return {
    cs: {
      title: "Stáhněte si archiv dokladů",
      body:
        "Faktury a doklady musíte uchovávat 10 let. Stáhněte si za uplynulé čtvrtletí ZIP s PDF a ISDOC, " +
        "nebo nastavte automatickou zálohu na vlastní SFTP či Google Disk.",
      link,
    },
    sk: {
      title: "Stiahnite si archív dokladov",
      body:
        "Faktúry a doklady musíte uchovávať 10 rokov. Stiahnite si za uplynulý štvrťrok ZIP s PDF a ISDOC, " +
        "alebo si nastavte automatickú zálohu na vlastné SFTP či Google Disk.",
      link,
    },
    en: {
      title: "Download your document archive",
      body:
        "Invoices and receipts have to be kept for 10 years. Download a ZIP with the PDF and ISDOC files for the last quarter, " +
        "or set up an automatic backup to your own SFTP or Google Drive.",
      link,
    },
  }[lang];
}
