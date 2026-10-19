import type { GlossaryTexts } from './types';

/** Slovak texts: shared terms under Slovak law, plus the Slovak-only terms. */
export const SK: GlossaryTexts = {
  'vat-payer': {
    term: 'Platiteľ a neplatiteľ DPH',
    aka: 'platiteľ dane z pridanej hodnoty',
    definition:
      'Platiteľ DPH je osoba registrovaná pre daň z pridanej hodnoty podľa § 4 zákona o DPH, ktorá k cenám svojich dodaní pripočítava DPH, odvádza ju štátu a môže si odpočítať daň z nákupov. Neplatiteľ DPH daň k cenám nepripočítava a odpočítať ju nemôže.',
    explanation: [
      'Podľa § 4 ods. 1 zákona o DPH sa platiteľom povinne stáva ten, koho obrat za kalendárny rok prekročí 50 000 €, a to od 1. januára nasledujúceho roka. Kto počas roka prekročí 62 500 €, je platiteľom už od dodania, ktorým limit prekročil. Registrovať sa dá aj dobrovoľne; platiteľ dostane IČ DPH.',
      'Platiteľ vyhotovuje faktúry s DPH, podáva daňové priznanie, kontrolný výkaz a pri dodaniach do iných štátov EÚ aj súhrnný výkaz. Neplatiteľ fakturuje bez DPH a daň na faktúre uviesť nesmie.',
      'Medzi oboma stavmi je osoba registrovaná podľa § 7a: nie je platiteľom, no pri službách z iných štátov EÚ musí daň priznať a zaplatiť.'
    ],
    example:
      'Grafička je platiteľka DPH. Za logo účtuje 1 000 € bez dane, k faktúre preto pripočíta 23 % DPH, teda 230 €, a celkovo fakturuje 1 230 €. Ako neplatiteľka by fakturovala len 1 000 €.',
    match: ['platiteľ(?:a|ovi|om|ov|ia)? DPH', 'neplatiteľ(?:a|ovi|om|ov|ia)? DPH']
  },
  'vat-rate': {
    term: 'Sadzba DPH',
    definition:
      'Sadzba DPH je percento, ktorým sa zo základu dane vypočíta daň z pridanej hodnoty. Na Slovensku platí od 1. januára 2025 základná sadzba 23 % a znížené sadzby 19 % a 5 %, niektoré dodania sú od dane oslobodené.',
    explanation: [
      'Ktorá sadzba sa na dodanie použije, určuje § 27 zákona o DPH a jeho prílohy. Základná sadzba platí vždy, keď zákon neustanovuje zníženú sadzbu alebo oslobodenie.',
      'Na faktúre platiteľa sa uvádza sadzba pri každej položke a suma dane podľa sadzieb. Pri prenesení daňovej povinnosti dodávateľ daň neuvádza, vypočíta ju odberateľ.'
    ],
    example: 'Z ceny 100 € bez dane je DPH pri základnej sadzbe 23 € a pri zníženej sadzbe 5 % len 5 €.',
    match: ['sadzb(?:a|y|u|ou|e) DPH']
  },
  'tax-base': {
    term: 'Základ dane (DPH)',
    definition:
      'Základ dane je suma, z ktorej sa počíta DPH: všetko, čo platiteľ za dodanie dostal alebo má dostať, bez samotnej dane z pridanej hodnoty.',
    explanation: [
      'Čo patrí do základu dane, určuje § 22 zákona o DPH. Patria doň aj vedľajšie náklady, ktoré dodávateľ zákazníkovi prefakturuje, napríklad doprava alebo balenie.',
      'Pri dodaní v cudzej mene sa základ dane prepočíta na eurá kurzom podľa zákona o DPH. Opravuje sa opravnou faktúrou, nie prepísaním pôvodnej faktúry.'
    ],
    example: 'Stolár účtuje stôl za 800 € a dopravu za 50 €, oboje bez DPH. Základ dane je 850 € a DPH 23 % z neho je 195,50 €.',
    match: ['základ(?:u|om)? dane']
  },
  invoice: {
    term: 'Faktúra',
    definition:
      'Faktúra je doklad, ktorým dodávateľ vyúčtuje odberateľovi tovar alebo službu a vyzve ho na zaplatenie. Faktúru platiteľa DPH upravuje zákon o DPH, ktorý určuje, kedy ju treba vyhotoviť a čo musí obsahovať.',
    explanation: [
      'Každý podnikateľ musí na faktúre, rovnako ako na ostatných obchodných listinách, uviesť obchodné meno, sídlo alebo miesto podnikania, IČO a údaj o zápise v registri (§ 3a Obchodného zákonníka).',
      'Platiteľ DPH vyhotovuje faktúru podľa § 71 zákona o DPH a uvádza na nej údaje podľa § 74, napríklad IČ DPH dodávateľa, dátum dodania a sumu dane podľa sadzieb.',
      'Neplatiteľ vyhotovuje faktúru bez DPH. Zákon o DPH sa na ňu nevzťahuje, údaje podľa Obchodného zákonníka však uviesť musí.'
    ],
    example:
      'Programátor neplatiteľ vyhotoví faktúru na 1 200 € za tvorbu webu. Uvedie svoje meno, adresu a IČO, údaje odberateľa, opis práce, sumu, dátum splatnosti a IBAN.',
    match: ['faktúr(?:a|y|u|ou|e|ach|am|ami)']
  },
  'invoice-number': {
    term: 'Číslo faktúry',
    aka: 'poradové číslo faktúry',
    definition:
      'Číslo faktúry je jednoznačné označenie dokladu v rade dokladov vystaviteľa. Zákon o DPH vyžaduje poradové číslo, ktoré faktúru jednoznačne identifikuje.',
    explanation: [
      'Povinnosť uviesť poradové číslo faktúry vyplýva z § 74 ods. 1 zákona o DPH. Formát si platiteľ zvolí sám, číslo sa však v jednej rade nesmie opakovať.',
      'Číslo faktúry sa často používa aj ako variabilný symbol platby, aby sa prichádzajúca platba dala ľahko spárovať s faktúrou.'
    ],
    example: 'Rad 2026001, 2026002, 2026003 … je platný. Dve rôzne faktúry s číslom 2026002 v tom istom rade platné nie sú.',
    match: ['čísl(?:o|a|om) faktúry', 'poradov(?:é|ého|ým) čísl(?:o|a|om)']
  },
  'advance-invoice': {
    term: 'Zálohová faktúra',
    aka: 'proforma faktúra',
    definition:
      'Zálohová faktúra je výzva na zaplatenie zálohy pred dodaním tovaru alebo služby. Nie je faktúrou podľa zákona o DPH; platiteľ vyhotovuje faktúru až k prijatej platbe.',
    explanation: [
      'Ak platiteľ prijme platbu pred dodaním, daňová povinnosť vzniká dňom prijatia platby (§ 19 ods. 4 zákona o DPH). K prijatej platbe preto vyhotoví faktúru podľa § 71.',
      'Po dodaní sa vyhotoví konečná faktúra, v ktorej sa prijatá záloha odpočíta. Neplatiteľ rieši len úhradu: pošle zálohovú faktúru a potom vyúčtovanie.'
    ],
    example:
      'Fotograf pred svadbou požiada o zálohu 200 € a pošle zálohovú faktúru. Keď záloha príde, vyhotoví k nej faktúru k prijatej platbe. Po svadbe vyfakturuje celých 600 € a odpočíta zaplatených 200 €.',
    match: ['zálohov(?:á|ej|ú|ou) faktúr(?:a|y|u|ou)', 'proforma faktúr(?:a|y|u|ou)']
  },
  'credit-note': {
    term: 'Dobropis',
    aka: 'opravná faktúra',
    definition:
      'Dobropis je doklad, ktorým dodávateľ znižuje predtým vyfakturovanú sumu, napríklad pri vrátení tovaru, zľave alebo chybe. U platiteľa DPH ide o opravnú faktúru, ktorou sa opravuje aj základ dane a daň.',
    explanation: [
      'Zmenu základu dane upravuje § 25 zákona o DPH; opravná faktúra je podľa § 71 ods. 2 tiež faktúrou. Opravná faktúra odkazuje na pôvodnú faktúru a uvádza rozdiel, nie novú celkovú sumu.',
      'Pôvodná faktúra sa neprepisuje ani nemaže. Opačný doklad, ktorý sumu zvyšuje, sa hovorovo nazýva ťarchopis.'
    ],
    example: 'Za dodané stoličky bolo vyfakturovaných 492 € s DPH. Zákazník jednu vrátil, dodávateľ preto vyhotoví dobropis na −123 € s DPH s odkazom na pôvodnú faktúru.',
    match: ['dobropis(?:u|om|y)?', 'opravn(?:á|ej|ú|ou) faktúr(?:a|y|u|ou)']
  },
  'reverse-charge': {
    term: 'Prenesenie daňovej povinnosti',
    aka: 'reverse charge',
    definition:
      'Prenesenie daňovej povinnosti je režim, v ktorom DPH nepriznáva dodávateľ, ale odberateľ. Dodávateľ vyhotoví faktúru bez dane a odberateľ daň sám vypočíta, prizná a spravidla si ju zároveň odpočíta.',
    explanation: [
      'Kedy je osobou povinnou platiť daň odberateľ, určuje § 69 zákona o DPH. V tuzemsku sa to podľa § 69 ods. 12 týka len vybraných dodaní medzi platiteľmi, napríklad stavebných prác alebo odpadu; rovnaký princíp platí pri službách a tovare medzi podnikateľmi z rôznych štátov EÚ.',
      'Faktúra v tomto režime obsahuje IČ DPH odberateľa a slová „prenesenie daňovej povinnosti“. Tuzemské dodania v tomto režime sa uvádzajú v kontrolnom výkaze.'
    ],
    example:
      'Stavebná firma platiteľ vykoná pre iného platiteľa stavebné práce za 10 000 €. Fakturuje 10 000 € bez DPH s poznámkou „prenesenie daňovej povinnosti“ a odberateľ si DPH 23 % vypočíta a prizná sám.',
    match: ['prenesen(?:ie|ia|í|ím) daňovej povinnosti', 'reverse charge']
  },
  'recapitulative-statement': {
    term: 'Súhrnný výkaz',
    definition:
      'Súhrnný výkaz je výkaz pre daňový úrad, v ktorom platiteľ uvádza dodania tovaru a služieb podnikateľom v iných štátoch EÚ. Údaje sa porovnávajú v celej EÚ cez systém VIES.',
    explanation: [
      'Povinnosť podávať súhrnný výkaz upravuje § 80 zákona o DPH. Podáva sa elektronicky do 25 dní po skončení kalendárneho mesiaca, v ktorom dodanie nastalo; za podmienok § 80 ho možno podávať štvrťročne.',
      'Vo výkaze sa uvádza IČ DPH zahraničného odberateľa, druh dodania a celková hodnota za obdobie. Bez dodaní do iného štátu EÚ sa nepodáva.'
    ],
    example: 'Prekladateľka v marci fakturovala služby nemeckej a rakúskej firme. Do 25. apríla podá súhrnný výkaz s IČ DPH oboch firiem a hodnotou služieb za marec.',
    match: ['súhrnn(?:ý|ého|om|ým) výkaz(?:u|om)?']
  },
  'vat-return': {
    term: 'Daňové priznanie k DPH',
    definition:
      'Daňové priznanie k DPH je tlačivo, v ktorom platiteľ za každé zdaňovacie obdobie uvedie daň na výstupe a odpočítanie dane a vypočíta daň na úhradu alebo nadmerný odpočet.',
    explanation: [
      'Daňové priznanie upravuje § 78 zákona o DPH. Podáva sa elektronicky do 25 dní po skončení zdaňovacieho obdobia a v tej istej lehote sa daň platí.',
      'Spolu s priznaním podáva platiteľ kontrolný výkaz a pri dodaniach do EÚ aj súhrnný výkaz.'
    ],
    example: 'Platiteľ s mesačným obdobím podáva priznanie za september do 25. októbra. Daň na výstupe 4 200 € mínus odpočet 1 500 € je daň na úhradu 2 700 €.',
    match: ['daňov(?:é|ého|om) priznani(?:e|a|u) k DPH']
  },
  'tax-period': {
    term: 'Zdaňovacie obdobie DPH',
    definition:
      'Zdaňovacie obdobie je úsek, za ktorý platiteľ podáva daňové priznanie k DPH: kalendárny mesiac, alebo pri splnení zákonných podmienok kalendárny štvrťrok.',
    explanation: [
      'Zdaňovacie obdobie upravuje § 77 zákona o DPH. Základným obdobím je mesiac; štvrťrok si môže zvoliť platiteľ, ktorý splní podmienky tohto paragrafu, a zmenu oznámi daňovému úradu.',
      'Kontrolný výkaz sa podáva za rovnaké obdobie ako daňové priznanie.'
    ],
    example: 'Platiteľ so štvrťročným obdobím podáva priznanie za júl až september do 25. októbra. Platiteľ s mesačným obdobím podáva za každý mesiac zvlášť.',
    match: ['zdaňovaci(?:e|eho|om) obdob(?:ie|ia|í)']
  },
  oss: {
    term: 'OSS',
    aka: 'One Stop Shop, osobitná úprava jednotného kontaktného miesta',
    definition:
      'OSS je režim, v ktorom podnikateľ priznáva DPH z predaja tovaru a služieb spotrebiteľom v iných štátoch EÚ v jedinom priznaní vo svojom štáte, namiesto registrácie v každom štáte zvlášť.',
    explanation: [
      'Osobitnú úpravu jednotného kontaktného miesta obsahuje zákon o DPH od § 68. Pri predaji na diaľku spotrebiteľom v inom štáte EÚ sa po prekročení celoúnijného limitu platí DPH podľa sadzby štátu zákazníka. OSS umožňuje túto daň priznať a zaplatiť cez slovenskú finančnú správu.',
      'Do OSS sa podnikateľ prihlasuje dobrovoľne elektronicky. Priznanie sa podáva štvrťročne a uvádza sa v ňom obrat a daň osobitne za každý štát.'
    ],
    example: 'E-shop z Košíc predáva spotrebiteľom v Česku a Maďarsku. Po prekročení limitu účtuje českým zákazníkom českú DPH a maďarským maďarskú a oboje prizná v jednom štvrťročnom priznaní OSS.',
    match: ['\\bOSS\\b', 'One Stop Shop']
  },
  'e-invoice': {
    term: 'Elektronická faktúra',
    aka: 'e-faktúra',
    definition:
      'Elektronická faktúra je faktúra vyhotovená a doručená v elektronickej podobe, napríklad ako PDF alebo štruktúrovaný súbor (Peppol UBL). Štruktúrovanú faktúru vie účtovný program načítať bez prepisovania.',
    explanation: [
      'Zákon o DPH považuje elektronickú faktúru za rovnocennú papierovej; dnes ju možno použiť, ak s tým príjemca súhlasí (§ 71 ods. 1 zákona o DPH). Musí byť zaručená vierohodnosť pôvodu, neporušenosť obsahu a čitateľnosť.',
      'Od 1. januára 2027 budú tuzemské faktúry medzi podnikateľmi povinne štruktúrované elektronické faktúry, doručované cez certifikovanú doručovaciu službu (v praxi sieť Peppol).'
    ],
    example: 'Dnes dodávateľ pošle e-mailom PDF faktúry. Od roku 2027 ju slovenskej firme pošle ako štruktúrovaný súbor cez doručovaciu službu a odberateľovi sa zobrazí priamo v účtovnom programe.',
    match: ['elektronick(?:á|ej|ú|ou) faktúr(?:a|y|u|ou)', 'e-faktúr(?:a|y|u|ou)']
  },
  peppol: {
    term: 'Peppol',
    definition:
      'Peppol je medzinárodná sieť a súbor štandardov na výmenu elektronických faktúr a ďalších obchodných dokumentov medzi firmami a úradmi. Faktúra sa posiela ako štruktúrovaný súbor vo formáte Peppol BIS (UBL) cez certifikované prístupové body.',
    explanation: [
      'Odosielateľ aj príjemca sa do siete pripájajú cez svojho poskytovateľa prístupového bodu a sú v nej dohľadateľní podľa identifikátora, zvyčajne IČ DPH alebo IČO. Formát Peppol BIS Billing 3.0 vychádza z európskej normy EN 16931.',
      'Na Slovensku sa od 1. januára 2027 tuzemské faktúry medzi podnikateľmi doručujú ako štruktúrované súbory cez certifikovanú doručovaciu službu, v praxi cez sieť Peppol.'
    ],
    example: 'Slovenská firma fakturuje belgickému odberateľovi. Namiesto PDF mu pošle faktúru cez Peppol a tá sa mu zobrazí priamo v účtovnom systéme.',
    match: ['\\bPeppol\\b']
  },
  'variable-symbol': {
    term: 'Variabilný symbol',
    aka: 'VS',
    definition:
      'Variabilný symbol je číslo s najviac desiatimi číslicami, ktoré platiteľ uvedie pri bankovej platbe, aby príjemca vedel, čo sa platí. Pri faktúre sa ako variabilný symbol zvyčajne používa číslo faktúry.',
    explanation: [
      'Variabilný symbol je zvyklosť platobného styku na Slovensku a v Česku, žiadny daňový zákon ho na faktúre nevyžaduje. Bez neho však dodávateľ ťažko páruje prichádzajúce platby.',
      'Pri platbách SEPA sa variabilný symbol prenáša v referencii platby. QR kód PAY by square ho obsahuje, takže ho odberateľ nemusí odpisovať.'
    ],
    example: 'Faktúra číslo 2026015 uvádza variabilný symbol 2026015. Odberateľ ho zadá k platbe a program dodávateľa platbu sám spáruje s faktúrou.',
    match: ['variabiln(?:ý|ého|ým|om) symbol(?:u|om)?']
  },
  'due-date': {
    term: 'Dátum splatnosti',
    aka: 'splatnosť faktúry',
    definition:
      'Dátum splatnosti je deň, do ktorého má odberateľ faktúru zaplatiť. Po jeho uplynutí je v omeškaní a dodávateľ môže požadovať úrok z omeškania.',
    explanation: [
      'Splatnosť si strany môžu dohodnúť. Medzi podnikateľmi však dohodnutá lehota nesmie presiahnuť 60 dní od doručenia faktúry alebo od plnenia, podľa toho, čo nastane neskôr (§ 340a Obchodného zákonníka).',
      'Peniaze sú zaplatené včas, keď sú v deň splatnosti pripísané na účet veriteľa, nie keď ich dlžník odošle.'
    ],
    example: 'Faktúra vystavená 1. júna so splatnosťou 14 dní je splatná 15. júna. Ak platba príde 18. júna, je odberateľ tri dni v omeškaní.',
    match: ['dátum(?:u|om)? splatnosti', 'splatnosť(?:ou)?']
  },
  'late-payment-interest': {
    term: 'Úrok z omeškania',
    definition:
      'Úrok z omeškania je suma, ktorú dlžník platí veriteľovi navyše za každý deň, keď je so zaplatením faktúry po splatnosti. Pri obchodných záväzkoch ho upravuje § 369 Obchodného zákonníka; ak sa strany na výške nedohodli, ustanovuje ju nariadenie vlády.',
    explanation: [
      'Veriteľ úrok z omeškania nemusí uplatniť; ak ho chce, vyčísli ho v upomienke alebo samostatnej faktúre.'
    ],
    example: 'Odberateľ zaplatí faktúru s oneskorením 20 dní. Dodávateľ mu pošle upomienku, v ktorej vyčísli úrok z omeškania za týchto 20 dní z dlžnej sumy.',
    match: ['úro(?:k|ku|kom|ky) z omeškania']
  },
  iban: {
    term: 'IBAN',
    aka: 'medzinárodné číslo bankového účtu',
    definition:
      'IBAN je medzinárodný formát čísla bankového účtu, ktorý sa začína kódom krajiny a dvoma kontrolnými číslicami. Slovenský IBAN má 24 znakov: SK, kontrolné číslice, kód banky, predčíslie a číslo účtu.',
    explanation: [
      'Na Slovensku sa IBAN používa pri všetkých platbách vrátane tuzemských, lebo SEPA platby ho vyžadujú. Kontrolné číslice odhalia väčšinu preklepov skôr, ako platba odíde.',
      'Na faktúre stačí uviesť IBAN, pri platbách zo zahraničia aj kód banky (BIC).'
    ],
    example: 'IBAN SK31 1200 0000 1987 4263 7541 má po SK kontrolné číslice 31, kód banky 1200, predčíslie 000019 a číslo účtu 8742637541.',
    match: ['\\bIBAN\\b']
  },
  'qr-payment': {
    term: 'QR platba',
    aka: 'PAY by square, v Česku QR Platba (SPAYD)',
    definition:
      'QR platba je QR kód na faktúre, ktorý obsahuje IBAN, sumu, variabilný symbol a ďalšie údaje k platbe. Odberateľ ho naskenuje v mobilnej banke a nič neodpisuje.',
    explanation: [
      'Na Slovensku sa používa formát PAY by square, v Česku formát QR Platba (SPAYD). Slovenské banky čítajú PAY by square, české banky QR Platbu.',
      'QR kód nie je povinným údajom faktúry. Zrýchľuje však platenie a obmedzuje chyby v IBAN a variabilnom symbole.'
    ],
    example: 'Faktúra na 340 € má v rohu QR kód PAY by square. Zákazník ho naskenuje, banka mu predvyplní IBAN, sumu aj variabilný symbol a on len potvrdí platbu.',
    match: ['QR plat(?:ba|by|bu|bou)', 'PAY by square']
  },
  vies: {
    term: 'VIES',
    aka: 'VAT Information Exchange System',
    definition:
      'VIES je systém Európskej komisie na overenie, či je IČ DPH podnikateľa z iného štátu EÚ platné na obchody v rámci EÚ. Cez VIES si štáty odovzdávajú aj údaje zo súhrnných výkazov.',
    explanation: [
      'Pred vyhotovením faktúry s prenesením daňovej povinnosti do iného štátu EÚ je vhodné overiť IČ DPH odberateľa vo VIES. Neplatné IČ DPH znamená, že odberateľ nie je registrovaný pre DPH.',
      'Výsledok overenia s dátumom je dobré uložiť ako dôkaz, že dodávateľ konal v dobrej viere.'
    ],
    example: 'Grafik fakturuje rakúskej agentúre. Vo VIES overí jej IČ DPH ATU12345678, systém ho potvrdí ako platné a grafik vyhotoví faktúru bez slovenskej DPH.',
    match: ['\\bVIES\\b']
  },
  'exchange-rate': {
    term: 'Kurz na prepočet cudzej meny',
    aka: 'referenčný kurz ECB',
    definition:
      'Pri faktúre v cudzej mene sa základ dane prepočítava na eurá referenčným výmenným kurzom, ktorý určuje a vyhlasuje Európska centrálna banka alebo Národná banka Slovenska. Rozhoduje kurz platný v deň predchádzajúci dňu vzniku daňovej povinnosti.',
    explanation: [
      'Prepočet cudzej meny na účely DPH upravuje § 26 ods. 1 zákona o DPH.',
      'Faktúru možno vyhotoviť v českých korunách alebo inej mene, daň na nej však musí byť uvedená aj v eurách.'
    ],
    example: 'Platiteľ dodá 10. marca službu za 25 000 Kč bez DPH a referenčný kurz ECB z 9. marca je 25,00 Kč/€. Základ dane je 1 000 € a DPH 23 % je 230 €.',
    match: ['kurz(?:u|om)? ECB']
  },
  dic: {
    term: 'DIČ',
    aka: 'daňové identifikačné číslo',
    definition:
      'DIČ je desaťmiestne daňové identifikačné číslo, ktoré prideľuje daňový úrad pri registrácii pre daň z príjmov. Nie je to IČ DPH: to dostane len ten, kto je registrovaný pre DPH.',
    explanation: [
      'DIČ majú podnikatelia aj firmy bez ohľadu na to, či sú platiteľmi DPH. IČ DPH platiteľa sa skladá z predpony SK a jeho DIČ.',
      'Na faktúre neplatiteľa sa uvádza IČO a DIČ, ak bolo pridelené; platiteľ uvádza IČ DPH.'
    ],
    example: 'Živnostník má DIČ 1023456789. Keď sa stane platiteľom DPH, jeho IČ DPH bude SK1023456789.',
    match: ['\\bDIČ\\b']
  },
  ico: {
    term: 'IČO',
    aka: 'identifikačné číslo organizácie',
    definition:
      'IČO je osemmiestne identifikačné číslo, ktoré jednoznačne označuje podnikateľa, firmu alebo inú právnickú osobu v registroch štátu. Uvádza sa na faktúrach a všetkých obchodných listinách.',
    explanation: [
      'IČO sa prideľuje pri vzniku firmy alebo začatí podnikania a počas existencie sa nemení. Podľa IČO sa dá podnikateľ dohľadať v registri právnických osôb alebo v obchodnom a živnostenskom registri.',
      'IČO slúži na identifikáciu, nie na dane. Na dane slúži DIČ a IČ DPH.'
    ],
    example: 'Vo fakturačnom programe stačí zadať IČO odberateľa a názov aj adresa sa doplnia z registra.',
    match: ['\\bIČO\\b']
  },
  'flat-rate-expenses': {
    term: 'Paušálne výdavky',
    definition:
      'Paušálne výdavky sú spôsob, ako si SZČO odpočíta od príjmov výdavky stanoveným percentom namiesto skutočných nákladov. Na Slovensku je to 60 % z príjmov, najviac 20 000 € za rok.',
    explanation: [
      'Paušálne výdavky upravuje § 6 ods. 10 zákona o dani z príjmov. Popri nich si SZČO odpočíta aj zaplatené povinné sociálne a zdravotné poistné.',
      'Paušál šetrí evidenciu výdavkov, ale môže vyjsť horšie ako skutočné výdavky, ak má podnikateľ vysoké náklady.'
    ],
    example: 'Programátor s príjmami 30 000 € si uplatní paušálne výdavky 60 %, teda 18 000 €. Pri príjmoch 40 000 € by to bolo 24 000 €, uplatní si preto len strop 20 000 €.',
    match: ['paušáln(?:e|ych|ymi) výdav(?:ky|kov|koch|kami)']
  },

  // Slovak-only terms.
  'delivery-date': {
    term: 'Dátum dodania',
    aka: 'deň dodania tovaru alebo služby',
    definition:
      'Dátum dodania je deň, keď platiteľ DPH dodal tovar alebo poskytol službu. Týmto dňom vzniká daňová povinnosť a podľa neho sa určuje, do ktorého zdaňovacieho obdobia dodanie patrí.',
    explanation: [
      'Kedy vzniká daňová povinnosť, ustanovuje § 19 zákona o DPH. Ak platiteľ prijme platbu ešte pred dodaním, daňová povinnosť vzniká dňom prijatia platby.',
      'Faktúru treba vyhotoviť najneskôr do 15 dní od dodania alebo od prijatia platby (§ 73 zákona o DPH). Dátum dodania sa uvádza na faktúre, ak sa líši od dátumu vyhotovenia.'
    ],
    example: 'Inštalatér dokončil prácu 28. marca a faktúru vyhotoví 2. apríla. Dátum dodania je 28. marca, takže daň patrí do priznania za marec.',
    match: ['dátum(?:u|om)? dodania']
  },
  'ic-dph': {
    term: 'IČ DPH',
    aka: 'identifikačné číslo pre daň z pridanej hodnoty',
    definition:
      'IČ DPH je identifikačné číslo pre daň z pridanej hodnoty, ktoré na Slovensku dostane platiteľ DPH alebo osoba registrovaná podľa § 7a. Má tvar SK a desať číslic DIČ.',
    explanation: [
      'IČ DPH prideľuje daňový úrad pri registrácii pre DPH (§ 4 a § 7a zákona o DPH). Uvádza sa na faktúrach a slúži na obchody v rámci EÚ, kde ho odberateľ overí vo VIES.',
      'DIČ a IČ DPH nie sú to isté: DIČ má každý daňový subjekt, IČ DPH len ten, kto je registrovaný pre DPH.'
    ],
    example: 'Firma s DIČ 2020123456 sa registruje za platiteľa DPH a dostane IČ DPH SK2020123456, ktoré odteraz uvádza na faktúrach.',
    match: ['IČ DPH']
  },
  'sk-control-statement': {
    term: 'Kontrolný výkaz',
    aka: 'KV DPH',
    definition:
      'Kontrolný výkaz je výkaz platiteľa DPH s údajmi o vyhotovených a prijatých faktúrach, podľa ktorého finančná správa páruje dodania medzi dodávateľmi a odberateľmi. Podáva sa elektronicky za každé zdaňovacie obdobie.',
    explanation: [
      'Povinnosť podávať kontrolný výkaz upravuje § 78a zákona o DPH. Podáva sa za rovnaké obdobie ako daňové priznanie, do 25 dní po jeho skončení.',
      'Vo výkaze sa uvádzajú faktúry s IČ DPH protistrany, malé doklady z registračnej pokladnice sa uvádzajú súhrnne. Za nepodanie alebo neskoré podanie hrozia pokuty.'
    ],
    example: 'Platiteľ v októbri vyhotovil faktúru inému platiteľovi a prijal faktúru za nájom. Obe uvedie v kontrolnom výkaze za október, ktorý podá do 25. novembra.',
    match: ['kontroln(?:ý|ého|om|ým) výkaz(?:u|om)?']
  },
  'section-7a-registration': {
    term: 'Registrácia podľa § 7a',
    aka: 'osoba registrovaná pre DPH podľa § 7a',
    definition:
      'Registrácia podľa § 7a zákona o DPH je registrácia osoby, ktorá nie je platiteľom DPH, ale prijíma služby od podnikateľov z iných štátov EÚ alebo im služby poskytuje. Dostane IČ DPH, z prijatých služieb daň prizná a zaplatí, odpočítať ju však nemôže.',
    explanation: [
      'Registrovať sa treba ešte pred prvým takým obchodom. Typicky ide o neplatiteľa, ktorý kupuje reklamu, softvér alebo služby platforiem zo zahraničia, alebo poskytuje službu podnikateľovi v inom štáte EÚ.',
      'Osoba registrovaná podľa § 7a podáva daňové priznanie len za obdobia, v ktorých mala takú službu, a súhrnný výkaz, ak službu do EÚ poskytla. Na tuzemských faktúrach DPH ďalej neúčtuje.'
    ],
    example: 'Neplatiteľ kúpi reklamu od írskej spoločnosti za 100 €. Ako osoba registrovaná podľa § 7a z nej prizná DPH 23 %, teda 23 €, a zaplatí ju daňovému úradu.',
    match: ['§\\s?7a']
  },
  'sk-e-invoicing-2027': {
    term: 'E-fakturácia od roku 2027',
    aka: 'povinná elektronická fakturácia na Slovensku',
    definition:
      'Od 1. januára 2027 sa tuzemské faktúry medzi podnikateľmi na Slovensku musia vyhotovovať ako štruktúrované elektronické faktúry a doručovať cez certifikovanú doručovaciu službu, v praxi cez sieť Peppol. PDF faktúra poslaná e-mailom ich nahradiť nemôže.',
    explanation: [
      'Povinnosť zaviedol zákon č. 385/2025 Z. z. do § 85o zákona o DPH. Faktúra musí zodpovedať európskej norme EN 16931, v praxi formátu Peppol BIS Billing 3.0 (UBL 2.1), vyhotovuje sa do 15 dní a doručuje sa cez certifikovanú doručovaciu službu podľa § 76a. Dodávateľ aj odberateľ do 5 dní oznamujú údaje z faktúry finančnému riaditeľstvu.',
      'Súhlas odberateľa s elektronickou faktúrou už nie je potrebný. Povinnosť sa týka tuzemských faktúr medzi podnikateľmi, faktúry spotrebiteľom sa nemenia.'
    ],
    example: 'Účtovníčka fakturuje mesačnú odmenu slovenskej firme. Od januára 2027 jej faktúru neposiela ako PDF, ale cez doručovaciu službu, a klientovi sa zobrazí priamo v jeho účtovnom programe.',
    match: ['e-fakturáci(?:a|e|u|ou|i)']
  },
  szco: {
    term: 'SZČO',
    aka: 'samostatne zárobkovo činná osoba',
    definition:
      'SZČO je fyzická osoba, ktorá podniká alebo vykonáva inú samostatnú zárobkovú činnosť, typicky na živnosť. Sama si platí daň z príjmov a odvody na sociálne a zdravotné poistenie.',
    explanation: [
      'Príjmy SZČO z podnikania zdaňuje § 6 zákona o dani z príjmov. Výdavky môže uplatniť skutočné alebo paušálne.',
      'Sociálne poistenie platí SZČO až vtedy, keď jej príjem za predchádzajúci rok prekročí zákonnú hranicu; zdravotné poistenie platí od začiatku podnikania. Výšku odvodov ukáže kalkulačka.'
    ],
    example: 'Grafik na živnosť je SZČO. Po skončení roka podá daňové priznanie, uplatní paušálne výdavky a podľa výsledku platí od júla odvody.',
    match: ['\\bSZČO\\b']
  }
};
