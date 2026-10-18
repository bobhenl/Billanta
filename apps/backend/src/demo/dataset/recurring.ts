import { daysFromNow } from "./dates";
import { SUPPLIERS, type DemoKind } from "./kinds";

/**
 * Recurring templates. The next run is always in the future, so the
 * scheduler never materialises an invoice during a 24-hour demo.
 */
export interface DemoRecurring {
  contactKey: string;
  frequency: "weekly" | "monthly" | "quarterly" | "yearly";
  nextRunDate: Date;
  currency: string;
  lines: Array<{ description: string; quantity: number; unitPrice: number; vatRate: number | null }>;
}

export function buildRecurring(kind: DemoKind, now: Date): DemoRecurring[] {
  const sup = SUPPLIERS[kind];
  const vat = sup.vatRate;
  const one = (contactKey: string, frequency: DemoRecurring["frequency"], days: number, description: string, unitPrice: number): DemoRecurring => ({
    contactKey,
    frequency,
    nextRunDate: daysFromNow(now, days),
    currency: sup.home,
    lines: [{ description, quantity: 1, unitPrice, vatRate: vat }],
  });
  switch (kind) {
    case "cz_vat_sro":
      return [
        one("javor", "monthly", 13, "Servis a údržba nábytku – měsíční paušál", 4_500),
        one("kavarna", "quarterly", 41, "Ošetření venkovního nábytku olejem", 6_800),
      ];
    case "cz_freelancer":
      return [one("kavarna", "monthly", 13, "Správa sociálních sítí – grafika", 6_000)];
    case "cz_pausal":
      return [
        one("javor", "monthly", 13, "Správa a hosting rezervačního systému", 3_500),
        one("atelier", "yearly", 120, "Prodloužení domény a SSL", 1_200),
      ];
    case "sk_vat_sro":
      return [one("tatranska", "monthly", 13, "Správa podujatí – mesačný paušál", 400)];
  }
}
