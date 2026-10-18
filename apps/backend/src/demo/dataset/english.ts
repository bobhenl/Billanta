import type { DemoDataset } from "./index";

/**
 * The demo in English, for a visitor on the `en` site. The companies stay
 * Czech and Slovak (that is who Billanta is for); every text a person wrote
 * becomes English and every document is issued in English. Proper names
 * (customers, suppliers, places) are left as they are.
 */
const EN: Record<string, string> = {
  // Supplier
  "Smyšlená firma z dema Billanta – není zapsána v žádném rejstříku.": "Fictional company from the Billanta demo – not listed in any register.",
  "Vymyslená firma z dema Billanta – nie je zapísaná v žiadnom registri.": "Fictional company from the Billanta demo – not listed in any register.",
  "Smyšlená osoba z dema Billanta – není zapsána v živnostenském rejstříku.": "Fictional person from the Billanta demo – not listed in the trade register.",
  "Hlavní účet": "Main account",
  "Eurový účet": "EUR account",
  "Účet": "Account",
  "Hlavný účet": "Main account",
  "Rezervný účet": "Reserve account",

  // Contact notes
  "Platí spíš pozdě, upomínat po týdnu.": "Tends to pay late, send a reminder after a week.",
  "Platia skôr neskoro, upomienku poslať po týždni.": "Tends to pay late, send a reminder after a week.",
  "Stálý klient, objednávky e-mailem.": "Regular client, orders come by e-mail.",
  "Stály klient, objednávky e-mailom.": "Regular client, orders come by e-mail.",

  // Invoices: joinery (cz_vat_sro)
  "Výroba barového pultu – dubová dýha": "Bar counter build – oak veneer",
  "Doprava a montáž": "Delivery and installation",
  "Opravný daňový doklad. Důvod opravy: sleva za posunutý termín montáže.": "Corrective tax document. Reason: discount for the postponed installation date.",
  "Sleva za posunutý termín montáže": "Discount for the postponed installation date",
  "Pracovní stůl na míru 180 × 80 cm": "Custom desk 180 × 80 cm",
  "Skříňka pod stůl, tři zásuvky": "Under-desk cabinet, three drawers",
  "Montáž": "Installation",
  "Kuchyňská linka – masivní dub, 3,2 m": "Kitchen units – solid oak, 3.2 m",
  "Zaměření a montáž": "Measuring and installation",
  "Montáž obkladů v rámci zakázky Hotel Javorový dvůr, 2. patro.": "Wall panelling installed as part of the Javorový dvůr hotel job, 2nd floor.",
  "Montáž dřevěných obkladů stěn": "Installation of wooden wall panelling",
  "Montáž zakázkových dveří": "Installation of custom doors",
  "Nástěnné police – ořech": "Wall shelves – walnut",
  "Recepční pult s osvětlením": "Reception desk with lighting",
  "Obložení schodiště – dubové stupně": "Staircase cladding – oak treads",
  "Zábradlí – ocel a dub": "Railing – steel and oak",
  "Návrh interiéru recepcie a lobby": "Reception and lobby interior design",
  "Vizualizácie (3 varianty)": "Visualisations (3 options)",
  "Záloha 50 % – knihovna přes celou stěnu": "50% advance – wall-to-wall bookcase",
  "Vestavěná skříň do předsíně": "Built-in hallway wardrobe",
  "Obložení restaurace – 3. etapa": "Restaurant panelling – phase 3",
  "Barový pult": "Bar counter",
  "Venkovní lavice – modřín": "Outdoor benches – larch",
  "Dětský pokoj na míru – postel, skříň, stůl": "Custom children's room – bed, wardrobe, desk",
  "Schodišťové madlo – dub": "Stair handrail – oak",
  "Faktura pro kavárnu U Tří lamp, oprava osmi židlí po pěti stech, plus doprava tisíc korun.":
    "Invoice for the U Tří lamp café, repair of eight chairs at five hundred each, plus a thousand crowns for delivery.",
  "Oprava židlí": "Chair repair",
  "Doprava": "Delivery",

  // Invoices: designer and developer (cz_freelancer, cz_pausal)
  "Návrh loga a základní vizuální identity": "Logo and core visual identity design",
  "Vývoj rezervačního systému – 1. etapa": "Booking system development – phase 1",
  "Jídelní lístek – grafická úprava": "Menu – graphic design",
  "Plakáty A2": "A2 posters",
  "Úprava webu – online menu": "Website update – online menu",
  "Opravný doklad. Důvod opravy: jedna položka nebyla dodána.": "Corrective document. Reason: one item was not delivered.",
  "Svatební oznámení – návrh": "Wedding announcements – design",
  "Tisk oznámení": "Printing the announcements",
  "Nastavení e-shopu a import produktů": "Online shop setup and product import",
  "Redesign webu – 2. etapa": "Website redesign – phase 2",
  "Napojení na platební bránu": "Payment gateway integration",
  "Ilustrace do výroční zprávy": "Illustrations for the annual report",
  "Správa serveru – měsíční paušál": "Server administration – monthly flat fee",
  "Fotografie interiérů hotelu": "Hotel interior photography",
  "Mobilní aplikace – prototyp": "Mobile app – prototype",
  "Vizitky – návrh": "Business cards – design",
  "Opravy chyb po spuštění": "Post-launch bug fixes",
  "Záloha – katalog podzimní kolekce": "Advance – autumn collection catalogue",
  "Záloha – migrace na nový hosting": "Advance – migration to new hosting",
  "Portrétní fotografie": "Portrait photography",
  "Instalace a nastavení NAS": "NAS installation and setup",
  "Kompletní vizuální identita hotelu": "Complete hotel visual identity",
  "Klientský portál – odhad": "Client portal – estimate",
  "Nový jídelní lístek – jaro": "New menu – spring",
  "Věrnostní program na webu": "Website loyalty programme",
  "Logo pro rodinnou pekárnu": "Logo for a family bakery",
  "Webová stránka pro řemeslníka": "Website for a tradesman",
  "Fotokniha – grafická úprava": "Photo book – layout",
  "Domácí síť a zálohování": "Home network and backups",
  "Infografika – výroční zpráva": "Infographics – annual report",
  "Programování – říjen": "Programming – October",
  "Fakturu pro kavárnu U Tří lamp za návrh letáku, tři tisíce dvě stě korun.":
    "Invoice the U Tří lamp café for a flyer design, three thousand two hundred crowns.",
  "Fakturu kavárně U Tří lamp, šest hodin úprav webu po devíti stech padesáti.":
    "Invoice the U Tří lamp café, six hours of website changes at nine hundred fifty.",
  "Návrh letáku": "Flyer design",
  "Úpravy webu": "Website changes",

  // Invoices: events (sk_vat_sro)
  "Teambuilding v Nízkych Tatrách – 24 osôb": "Team building in the Low Tatras – 24 people",
  "Doprava autobusom": "Coach transport",
  "Opravná faktúra. Dôvod opravy: zúčastnilo sa o dve osoby menej.": "Corrective invoice. Reason: two fewer people took part.",
  "Organizácia svadby – koordinácia v deň D": "Wedding planning – coordination on the day",
  "Výzdoba sály": "Hall decoration",
  "Oslava 50. narodenín – organizácia": "50th birthday party – organisation",
  "Firemný večierok – program a moderátor": "Company party – programme and host",
  "Fotograf na podujatie": "Event photographer",
  "Zimný výstup na Chopok – sprievodcovia": "Winter ascent of Chopok – guides",
  "Požičanie výstroja": "Equipment rental",
  "Rozlúčka so slobodou – rafting na Dunajci": "Stag party – rafting on the Dunajec",
  "Příprava firemního výletu do Vysokých Tater": "Preparing a company trip to the High Tatras",
  "Koordinace fotografování v Tatrách": "Photo shoot coordination in the Tatras",
  "Záloha – vianočný večierok": "Advance – Christmas party",
  "Výlet na Štrbské pleso – rodina": "Family trip to Štrbské pleso",
  "Letný teambuilding – 40 osôb, 2 dni": "Summer team building – 40 people, 2 days",
  "Oslava výročia – catering a program": "Anniversary party – catering and programme",
  "Splav Hrona – 12 osôb": "Hron river trip – 12 people",
  "Vianočný večierok – doplatok": "Christmas party – balance",
  "Faktúra pre Mareka Kováča, sprievodca na celý deň za tristo eur.": "Invoice for Marek Kováč, a guide for the whole day, three hundred euros.",
  "Sprievodca – celý deň": "Guide – full day",

  // Expenses
  "Dubové fošny 40 mm, 2,4 m³": "Oak planks 40 mm, 2.4 m³",
  "Ořechová dýha a lepidlo": "Walnut veneer and glue",
  "Panty, výsuvy a úchytky": "Hinges, drawer slides and handles",
  "Tvrdý voskový olej 25 l": "Hard wax oil 25 l",
  "Nájem dílny – září": "Workshop rent – September",
  "Nájem dílny – říjen": "Workshop rent – October",
  "Nafta – dodávka": "Diesel – van",
  "Mobilní tarify – 3 čísla": "Mobile plans – 3 numbers",
  "Formátování desek na zakázku": "Cutting boards to size",
  "Subdodávka – montáž obkladů, Hotel Javorový dvůr": "Subcontract – panelling installation, Javorový dvůr hotel",
  "Licence CAD programu – roční": "CAD software licence – annual",
  "Placeno kartou.": "Paid by card.",
  "Skicáky a fixy": "Sketchbooks and markers",
  "Místo v coworkingu – září": "Coworking desk – September",
  "Místo v coworkingu – říjen": "Coworking desk – October",
  "Tisk portfolia, 5 kusů": "Portfolio printing, 5 copies",
  "Mobilní tarif": "Mobile plan",
  "Pronájem studia na půl dne": "Studio rental for half a day",
  "Předplatné grafického programu – měsíční": "Graphics software subscription – monthly",
  "VPS – čtvrtletně": "VPS – quarterly",
  'Externí monitor 27"': 'External monitor 27"',
  "Internet a mobil": "Internet and mobile",
  "Vstupenka na vývojářskou konferenci": "Developer conference ticket",
  "Preprava 24 osôb Bratislava – Jasná": "Transport for 24 people, Bratislava – Jasná",
  "Ubytovanie a strava – teambuilding": "Accommodation and meals – team building",
  "Nájom kancelárie – september": "Office rent – September",
  "Nájom kancelárie – október": "Office rent – October",
  "Letáky a roll-up": "Flyers and a roll-up banner",
  "Mobilné paušály": "Mobile plans",
  "Nafta – služobné auto": "Diesel – company car",
  "Požičanie výstroja na výstup": "Equipment rental for the ascent",
  "Registračný systém na podujatia – ročná licencia": "Event registration system – annual licence",

  // Time tracking
  "Hotel Javorový dvůr – 3. etapa": "Javorový dvůr hotel – phase 3",
  "Kavárna – venkovní lavice": "Café – outdoor benches",
  "Zaměření restaurace": "Measuring the restaurant",
  "Výkresy obkladů": "Panelling drawings",
  "Konzultace s architektem": "Meeting with the architect",
  "Příprava modřínových prken": "Preparing larch boards",
  "Spojování sedáků": "Joining the seats",
  "Vzorky dýhy pro klienta": "Veneer samples for the client",
  "Povrchová úprava": "Finishing",
  "Cesta na stavbu": "Travel to the site",
  "Kompletace lavic": "Assembling the benches",
  "Javorový dvůr – vizuální identita": "Javorový dvůr – visual identity",
  "Sedmikráska – katalog": "Sedmikráska – catalogue",
  "Moodboard a rešerše": "Moodboard and research",
  "Skici loga – 3 směry": "Logo sketches – 3 directions",
  "Sazba – úvodní strany": "Typesetting – opening pages",
  "Retuše fotek produktů": "Product photo retouching",
  "Prezentace klientovi": "Client presentation",
  "Korektury": "Proofreading",
  "Úpravy loga po prezentaci": "Logo changes after the presentation",
  "Příprava tiskových dat": "Preparing print files",
  "Interní schůzka": "Internal meeting",
  "Barevná paleta a typografie": "Colour palette and typography",
  "Rezervační systém – 2. etapa": "Booking system – phase 2",
  "Klientský portál": "Client portal",
  "Platby kartou – napojení": "Card payments – integration",
  "Oprava časových pásem": "Time zone fix",
  "Návrh databáze": "Database design",
  "Přihlášení a role": "Sign-in and roles",
  "Code review a nasazení": "Code review and deployment",
  "Nahrávání souborů": "File uploads",
  "Testy": "Tests",
  "Hotfix – e-maily s potvrzením": "Hotfix – confirmation e-mails",
  "Studium nové knihovny": "Learning a new library",
  "Notifikace": "Notifications",
  "Letný teambuilding – Tatranská chata": "Summer team building – Tatranská chata",
  "Oslava výročia – Kováč": "Anniversary party – Kováč",
  "Obhliadka chaty a okolia": "Visiting the lodge and its surroundings",
  "Návrh programu na dva dni": "Two-day programme draft",
  "Stretnutie s klientom": "Client meeting",
  "Výber cateringu": "Choosing the catering",
  "Rezervácia dopravy": "Booking transport",
  "Rozpočet a ponuka": "Budget and quote",
  "Výzdoba – nákup a príprava": "Decorations – shopping and preparation",
  "Interná porada": "Internal meeting",
  "Koordinácia dodávateľov": "Coordinating suppliers",

  // Recurring
  "Servis a údržba nábytku – měsíční paušál": "Furniture service and maintenance – monthly flat fee",
  "Ošetření venkovního nábytku olejem": "Oiling the outdoor furniture",
  "Správa sociálních sítí – grafika": "Social media management – graphics",
  "Správa a hosting rezervačního systému": "Booking system hosting and maintenance",
  "Prodloužení domény a SSL": "Domain and SSL renewal",
  "Správa podujatí – mesačný paušál": "Event management – monthly flat fee",
};

const UNITS: Record<string, string> = { ks: "pcs", hod: "h", "os.": "pers.", "deň": "day", m: "m", "m²": "m²", h: "h", pcs: "pcs", day: "day" };

/**
 * `missing` collects source texts without a translation (the spec keeps it
 * empty). Texts of documents already written in English are left alone.
 */
export function toEnglish(ds: DemoDataset, missing: string[] = []): DemoDataset {
  const tr = (text: string): string => {
    const hit = EN[text];
    if (hit === undefined) missing.push(text);
    return hit ?? text;
  };
  const trOpt = (text: string | null): string | null => (text === null ? null : tr(text));
  const unit = (u: string | null): string | null => {
    if (u === null) return null;
    if (!(u in UNITS)) missing.push(u);
    return UNITS[u] ?? u;
  };

  return {
    ...ds,
    supplier: {
      ...ds.supplier,
      tenant: { ...ds.supplier.tenant, default_locale: "en", registry_note: tr(ds.supplier.tenant.registry_note) },
      bank: ds.supplier.bank.map((b) => ({ ...b, label: tr(b.label) })),
    },
    contacts: ds.contacts.map((c) => ({ ...c, internalNote: trOpt(c.internalNote) })),
    invoices: ds.invoices.map((inv) => {
      if (inv.language === "en") return inv;
      return {
        ...inv,
        language: "en",
        noteAbove: trOpt(inv.noteAbove),
        ai: inv.ai && { ...inv.ai, transcript: tr(inv.ai.transcript) },
        lines: inv.lines.map((l) => ({ ...l, description: tr(l.description), unit: unit(l.unit) })),
      };
    }),
    expenses: ds.expenses.map((e) => ({ ...e, description: tr(e.description), note: trOpt(e.note) })),
    time: {
      projects: ds.time.projects.map((p) => ({ ...p, name: tr(p.name) })),
      entries: ds.time.entries.map((t) => ({ ...t, description: tr(t.description) })),
    },
    recurring: ds.recurring.map((r) => ({ ...r, lines: r.lines.map((l) => ({ ...l, description: tr(l.description) })) })),
  };
}
