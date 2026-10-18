/** The few e-mails classroom mode sends, all to teachers (students have no address). */
export type MailLanguage = "cs" | "sk" | "en";

export interface Mail {
  title: string;
  body: string;
}

export function mailLanguage(country: "CZ" | "SK"): MailLanguage {
  return country === "SK" ? "sk" : "cs";
}

export function approvedMail(lang: MailLanguage, siteUrl: string): Mail {
  const url = `${siteUrl}/${lang}/classroom`;
  if (lang === "sk") return { title: "Školský režim je zapnutý", body: `Vaša žiadosť bola schválená. Prvú triedu založíte tu: ${url}` };
  if (lang === "en") return { title: "Classroom mode is on", body: `Your application was approved. Create your first class here: ${url}` };
  return { title: "Školní režim je zapnutý", body: `Vaše žádost byla schválena. První třídu založíte tady: ${url}` };
}

export function rejectedMail(lang: MailLanguage, note: string | null | undefined): Mail {
  const reason = note?.trim() ? `\n\n${note.trim()}` : "";
  if (lang === "sk")
    return {
      title: "Žiadosť o školský režim",
      body: `Vašu žiadosť sme zatiaľ nemohli schváliť. Ak učíte na tejto škole, odpovedzte nám na tento e-mail.${reason}`,
    };
  if (lang === "en")
    return {
      title: "Your classroom mode application",
      body: `We could not approve your application yet. If you teach at this school, reply to this e-mail.${reason}`,
    };
  return {
    title: "Žádost o školní režim",
    body: `Vaši žádost jsme zatím nemohli schválit. Pokud na této škole učíte, odpovězte nám na tento e-mail.${reason}`,
  };
}

export function inviteMail(lang: MailLanguage, siteUrl: string, inviter: string, school: string): Mail {
  const url = `${siteUrl}/${lang}/for-schools/apply`;
  if (lang === "sk")
    return {
      title: `${inviter} vás pozýva do školského režimu Billanta`,
      body: `${inviter} zo školy ${school} vás pozýva učiť fakturáciu v Billante. Prihláste sa týmto e-mailom a vyplňte krátku žiadosť, schváli sa hneď: ${url}`,
    };
  if (lang === "en")
    return {
      title: `${inviter} invites you to Billanta classroom mode`,
      body: `${inviter} from ${school} invites you to teach invoicing with Billanta. Sign in with this e-mail address and fill in the short application; it is approved right away: ${url}`,
    };
  return {
    title: `${inviter} vás zve do školního režimu Billanta`,
    body: `${inviter} ze školy ${school} vás zve učit fakturaci v Billantě. Přihlaste se tímto e-mailem a vyplňte krátkou žádost, schválí se hned: ${url}`,
  };
}

/** 30 and 7 days before the end: extend the class or download the students' work. */
export function endingMail(lang: MailLanguage, siteUrl: string, className: string, classId: string, days: number, endsAt: Date): Mail {
  const url = `${siteUrl}/${lang}/classroom/${classId}`;
  const date = endsAt.toLocaleDateString(lang === "en" ? "en-GB" : lang === "sk" ? "sk-SK" : "cs-CZ", { timeZone: "Europe/Prague" });
  if (lang === "sk")
    return {
      title: `Trieda ${className} končí o ${days} dní`,
      body: `Trieda ${className} končí ${date}. Potom budú cvičné firmy 30 dní len na čítanie a potom sa zmažú. Ak má trieda pokračovať, predĺžte ju na ďalší školský rok; prehľad postupu si môžete stiahnuť: ${url}`,
    };
  if (lang === "en")
    return {
      title: `Class ${className} ends in ${days} days`,
      body: `Class ${className} ends on ${date}. After that the practice companies are read-only for 30 days and then deleted. To keep the class, extend it to the next school year; you can download the progress overview: ${url}`,
    };
  return {
    title: `Třída ${className} končí za ${days} dní`,
    body: `Třída ${className} končí ${date}. Potom budou cvičné firmy 30 dní jen ke čtení a pak se smažou. Pokud má třída pokračovat, prodlužte ji na další školní rok; přehled postupu si můžete stáhnout: ${url}`,
  };
}

/** For Billanta staff, in Czech like the other staff notices. */
export function staffApplicationMail(siteUrl: string, teacher: string, school: string, ico: string): Mail {
  return {
    title: `Školní režim: nová žádost (${school})`,
    body: `${teacher} žádá o školní režim pro ${school} (IČO ${ico}). Ke kontrole: ${siteUrl}/cs/admin/classroom`,
  };
}

/** Which reminder is due: the smallest threshold reached and not yet sent. */
export function dueReminder(endsAt: Date, now: Date, remindedDays: number | null): 30 | 7 | null {
  const daysLeft = (endsAt.getTime() - now.getTime()) / 86_400_000;
  if (daysLeft <= 0) return null;
  if (daysLeft <= 7 && (remindedDays === null || remindedDays > 7)) return 7;
  if (daysLeft <= 30 && remindedDays === null) return 30;
  return null;
}
