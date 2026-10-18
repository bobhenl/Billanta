import { addHours, daysAgo } from "./dates";
import { SUPPLIERS, type DemoKind } from "./kinds";

export interface DemoProject {
  key: string;
  name: string;
  contactKey: string;
  hourlyRate: number;
  currency: string;
  color: string;
}

export interface DemoTimeEntry {
  projectKey: string;
  description: string;
  startedAt: Date;
  minutes: number;
  billable: boolean;
}

export interface DemoTime {
  projects: DemoProject[];
  entries: DemoTimeEntry[];
}

interface Plan {
  projects: Array<Omit<DemoProject, "currency">>;
  /** [projectKey, description, daysBack, minutes, billable?] */
  entries: Array<[string, string, number, number, boolean?]>;
}

const PLANS: Record<DemoKind, Plan> = {
  cz_vat_sro: {
    projects: [
      { key: "hotel", name: "Hotel Javorový dvůr – 3. etapa", contactKey: "javor", hourlyRate: 850, color: "indigo" },
      { key: "cafe", name: "Kavárna – venkovní lavice", contactKey: "kavarna", hourlyRate: 850, color: "amber" },
    ],
    entries: [
      ["hotel", "Zaměření restaurace", 16, 180],
      ["hotel", "Výkresy obkladů", 15, 240],
      ["hotel", "Konzultace s architektem", 12, 90],
      ["cafe", "Příprava modřínových prken", 9, 300],
      ["cafe", "Spojování sedáků", 8, 360],
      ["hotel", "Vzorky dýhy pro klienta", 6, 120],
      ["cafe", "Povrchová úprava", 4, 240],
      ["hotel", "Cesta na stavbu", 2, 60, false],
      ["cafe", "Kompletace lavic", 1, 300],
    ],
  },
  cz_freelancer: {
    projects: [
      { key: "hotel", name: "Javorový dvůr – vizuální identita", contactKey: "javor", hourlyRate: 900, color: "indigo" },
      { key: "catalog", name: "Sedmikráska – katalog", contactKey: "atelier", hourlyRate: 900, color: "green" },
    ],
    entries: [
      ["hotel", "Moodboard a rešerše", 18, 150],
      ["hotel", "Skici loga – 3 směry", 16, 270],
      ["catalog", "Sazba – úvodní strany", 13, 210],
      ["catalog", "Retuše fotek produktů", 11, 330],
      ["hotel", "Prezentace klientovi", 9, 90],
      ["catalog", "Korektury", 7, 120],
      ["hotel", "Úpravy loga po prezentaci", 5, 180],
      ["catalog", "Příprava tiskových dat", 3, 150],
      ["hotel", "Interní schůzka", 2, 45, false],
      ["hotel", "Barevná paleta a typografie", 1, 240],
    ],
  },
  cz_pausal: {
    projects: [
      { key: "booking", name: "Rezervační systém – 2. etapa", contactKey: "javor", hourlyRate: 950, color: "indigo" },
      { key: "portal", name: "Klientský portál", contactKey: "atelier", hourlyRate: 950, color: "green" },
    ],
    entries: [
      ["booking", "Platby kartou – napojení", 19, 300],
      ["booking", "Oprava časových pásem", 17, 120],
      ["portal", "Návrh databáze", 15, 240],
      ["portal", "Přihlášení a role", 12, 360],
      ["booking", "Code review a nasazení", 10, 90],
      ["portal", "Nahrávání souborů", 8, 300],
      ["portal", "Testy", 6, 180],
      ["booking", "Hotfix – e-maily s potvrzením", 4, 75],
      ["portal", "Studium nové knihovny", 3, 120, false],
      ["portal", "Notifikace", 1, 270],
    ],
  },
  sk_vat_sro: {
    projects: [
      { key: "summer", name: "Letný teambuilding – Tatranská chata", contactKey: "tatranska", hourlyRate: 45, color: "sky" },
      { key: "anniversary", name: "Oslava výročia – Kováč", contactKey: "kovac", hourlyRate: 45, color: "amber" },
    ],
    entries: [
      ["summer", "Obhliadka chaty a okolia", 17, 240],
      ["summer", "Návrh programu na dva dni", 15, 180],
      ["anniversary", "Stretnutie s klientom", 13, 90],
      ["anniversary", "Výber cateringu", 11, 120],
      ["summer", "Rezervácia dopravy", 9, 60],
      ["summer", "Rozpočet a ponuka", 7, 150],
      ["anniversary", "Výzdoba – nákup a príprava", 5, 210],
      ["summer", "Interná porada", 3, 45, false],
      ["anniversary", "Koordinácia dodávateľov", 1, 120],
    ],
  },
  sk_freelancer: {
    projects: [
      { key: "manual", name: "Návod k CNC stroju – Strojárne Považie", contactKey: "povazie", hourlyRate: 30, color: "indigo" },
      { key: "wine", name: "Etikety a technické listy – vinárstvo", contactKey: "zobor", hourlyRate: 30, color: "pink" },
    ],
    entries: [
      ["manual", "Terminológia a glosár", 16, 150],
      ["manual", "Preklad kapitol 1–3", 15, 300],
      ["wine", "Preklad etikiet", 13, 180],
      ["manual", "Preklad kapitol 4–6", 12, 330],
      ["wine", "Konzultácia s enológom", 10, 60],
      ["manual", "Kontrola rozmerov a jednotiek", 8, 120],
      ["wine", "Technické listy – preklad", 6, 240],
      ["manual", "Webinár o strojnom preklade", 4, 90, false],
      ["wine", "Korektúra a odovzdanie", 2, 120],
      ["manual", "Preklad kapitol 7–8", 1, 270],
    ],
  },
  sk_vat_freelancer: {
    projects: [
      { key: "ovens", name: "Pekáreň Gazdovská – pripojenie pecí", contactKey: "gazdovska", hourlyRate: 32, color: "amber" },
      { key: "charger", name: "Nabíjacia stanica – Kováč", contactKey: "kovac", hourlyRate: 32, color: "teal" },
    ],
    entries: [
      ["ovens", "Obhliadka a zameranie", 14, 120],
      ["ovens", "Ťahanie káblov", 12, 420],
      ["charger", "Návrh pripojenia a istenia", 10, 90],
      ["ovens", "Zapojenie rozvádzača", 9, 360],
      ["ovens", "Skúška a uvedenie do prevádzky", 7, 180],
      ["charger", "Montáž wallboxu", 5, 240],
      ["charger", "Revízia a protokol", 4, 120],
      ["ovens", "Nákup materiálu", 3, 60, false],
      ["charger", "Nastavenie aplikácie s klientom", 1, 45],
    ],
  },
};

export function buildTime(kind: DemoKind, now: Date): DemoTime {
  const plan = PLANS[kind];
  const currency = SUPPLIERS[kind].home;
  return {
    projects: plan.projects.map((p) => ({ ...p, currency })),
    entries: plan.entries.map(([projectKey, description, back, minutes, billable]) => ({
      projectKey,
      description,
      // The work day starts at 9:00 local; daysAgo() gives 10:00 UTC.
      startedAt: addHours(daysAgo(now, back), -3),
      minutes,
      billable: billable ?? true,
    })),
  };
}
