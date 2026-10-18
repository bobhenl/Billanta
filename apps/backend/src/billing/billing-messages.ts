import type { PlanKey } from "./plans";

/**
 * Wording of the billing notices (bell + optional e-mail) in the company's
 * default language. The dashboard's own copy lives in the frontend messages;
 * these are sent from cron jobs and admin actions, where there is no request
 * locale to go by.
 */
type Lang = "cs" | "sk" | "en";

const PLAN_NAMES: Record<Lang, Record<PlanKey, string>> = {
  cs: { free: "Zdarma", start: "Start", plus: "Plus", business: "Firma" },
  sk: { free: "Zadarmo", start: "Start", plus: "Plus", business: "Firma" },
  en: { free: "Free", start: "Start", plus: "Plus", business: "Business" },
};

function langOf(locale: string | null | undefined): Lang {
  return locale === "sk" || locale === "en" ? locale : "cs";
}

/** "1 den / 2 dny / 5 dní" and the Slovak and English equivalents. */
function days(lang: Lang, n: number): string {
  if (lang === "en") return n === 1 ? "1 day" : `${n} days`;
  if (lang === "sk") return n === 1 ? "1 deň" : n >= 2 && n <= 4 ? `${n} dni` : `${n} dní`;
  return n === 1 ? "1 den" : n >= 2 && n <= 4 ? `${n} dny` : `${n} dní`;
}

export function trialReminderMessage(locale: string | null | undefined, plan: PlanKey, daysLeft: number) {
  const lang = langOf(locale);
  const name = PLAN_NAMES[lang][plan];
  const free = PLAN_NAMES[lang].free;
  const link = "/billing";
  if (daysLeft <= 0) {
    return {
      cs: {
        title: `Zkušební verze tarifu ${name} skončila`,
        body: `Firma teď běží na tarifu ${free}. Nic se nesmazalo, funkce nad jeho rámec jsou jen pro čtení, dokud si nevyberete placený tarif.`,
        link,
      },
      sk: {
        title: `Skúšobná verzia tarifu ${name} sa skončila`,
        body: `Firma teraz používa tarif ${free}. Nič sa nevymazalo, funkcie nad jeho rámec sú len na čítanie, kým si nevyberiete platený tarif.`,
        link,
      },
      en: {
        title: `Your ${name} trial has ended`,
        body: `The company is now on the ${free} plan. Nothing was deleted; features above it are read-only until you pick a paid plan.`,
        link,
      },
    }[lang];
  }
  const left = days(lang, daysLeft);
  return {
    cs: {
      title: `Zkušební verze tarifu ${name} končí za ${left}`,
      body: `Potom firma přejde na tarif ${free}. Data zůstanou, funkce nad jeho rámec budou jen pro čtení. Tarif si vyberete v Předplatném, bez závazku.`,
      link,
    },
    sk: {
      title: `Skúšobná verzia tarifu ${name} končí o ${left}`,
      body: `Potom firma prejde na tarif ${free}. Údaje zostanú, funkcie nad jeho rámec budú len na čítanie. Tarif si vyberiete v časti Predplatné, bez záväzku.`,
      link,
    },
    en: {
      title: `Your ${name} trial ends in ${left}`,
      body: `After that the company moves to the ${free} plan. Your data stays; features above it become read-only. Pick a plan under Billing, no commitment.`,
      link,
    },
  }[lang];
}

export function planPaidMessage(locale: string | null | undefined, plan: PlanKey, until: string) {
  const lang = langOf(locale);
  const name = PLAN_NAMES[lang][plan];
  const [y, m, d] = until.split("-");
  const date = lang === "en" ? until : `${Number(d)}. ${Number(m)}. ${y}`;
  return {
    cs: { title: `Platba přijata, tarif ${name} platí do ${date}`, body: "Děkujeme za platbu.", link: "/billing" },
    sk: { title: `Platba prijatá, tarif ${name} platí do ${date}`, body: "Ďakujeme za platbu.", link: "/billing" },
    en: { title: `Payment received, ${name} is paid until ${date}`, body: "Thank you for your payment.", link: "/billing" },
  }[lang];
}

/** What the prepaid-period reminder needs to know about the renewal proforma. */
export interface RenewalProforma {
  number: string;
  months: number;
  totalMinor: number;
  variableSymbol: string;
  dueDate: string;
  account: string | null;
  iban: string;
}

function dateOf(lang: Lang, iso: string): string {
  const [y, m, d] = iso.split("-");
  return lang === "en" ? iso : `${Number(d)}. ${Number(m)}. ${y}`;
}

function czk(lang: Lang, minor: number): string {
  const locale = lang === "en" ? "en-GB" : lang === "sk" ? "sk-SK" : "cs-CZ";
  return new Intl.NumberFormat(locale, { style: "currency", currency: "CZK" }).format(minor / 100);
}

/** Proformas are for a month or a year (PROFORMA_MONTHS). */
function periodOf(lang: Lang, months: number): string {
  if (lang === "en") return months === 12 ? "year" : "month";
  if (lang === "sk") return months === 12 ? "rok" : "mesiac";
  return months === 12 ? "rok" : "měsíc";
}

/**
 * "Your prepaid plan ends in 14 / 3 days" with the renewal proforma: the
 * text for the bell and the e-mail, and the payment details table for the
 * e-mail (the QR code goes along as an attachment).
 */
export function prepaidReminderMessage(
  locale: string | null | undefined,
  plan: PlanKey,
  until: string,
  daysLeft: number,
  proforma: RenewalProforma,
) {
  const lang = langOf(locale);
  const name = PLAN_NAMES[lang][plan];
  const date = dateOf(lang, until);
  const left = days(lang, daysLeft);
  const period = periodOf(lang, proforma.months);
  const link = "/billing";
  const notice = {
    cs: {
      title: `Tarif ${name} máte zaplacený do ${date}, zbývá ${left}`,
      body:
        `Platba převodem se sama neobnovuje, proto jsme připravili zálohovou fakturu ${proforma.number} na další ${period}. ` +
        "Zaplatit ji můžete QR kódem z přílohy nebo podle údajů níže. Když platba dorazí před koncem, o žádný den nepřijdete. " +
        "Pohodlnější a levnější je předplatné kartou, které se obnovuje samo. Zapnete ho v části Tarif a platby.",
      link,
    },
    sk: {
      title: `Tarif ${name} máte zaplatený do ${date}, zostáva ${left}`,
      body:
        `Platba prevodom sa sama neobnovuje, preto sme pripravili zálohovú faktúru ${proforma.number} na ďalší ${period}. ` +
        "Zaplatiť ju môžete QR kódom z prílohy alebo podľa údajov nižšie. Ak platba príde pred koncom, o žiadny deň neprídete. " +
        "Pohodlnejšie a lacnejšie je predplatné kartou, ktoré sa obnovuje samo. Zapnete ho v časti Tarif a platby.",
      link,
    },
    en: {
      title: `Your ${name} plan is paid until ${date}, ${left} left`,
      body:
        `A bank transfer doesn't renew by itself, so we've issued proforma ${proforma.number} for another ${period}. ` +
        "Pay it with the attached QR code or the details below. If the payment arrives before the end, you don't lose a day. " +
        "A card subscription is easier and cheaper, and it renews by itself. You can switch to it under Billing.",
      link,
    },
  }[lang];
  const labels = {
    cs: { amount: "Částka", vs: "Variabilní symbol", account: "Číslo účtu", due: "Splatnost" },
    sk: { amount: "Suma", vs: "Variabilný symbol", account: "Číslo účtu", due: "Splatnosť" },
    en: { amount: "Amount", vs: "Variable symbol", account: "Account number", due: "Due date" },
  }[lang];
  const details = [
    { label: labels.amount, value: czk(lang, proforma.totalMinor) },
    { label: labels.vs, value: proforma.variableSymbol },
    ...(proforma.account ? [{ label: labels.account, value: proforma.account }] : []),
    { label: "IBAN", value: proforma.iban },
    { label: labels.due, value: dateOf(lang, proforma.dueDate) },
  ];
  return { notice, details, lang };
}
