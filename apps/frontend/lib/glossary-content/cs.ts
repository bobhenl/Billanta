import type { GlossaryTexts } from './types';

/** Czech texts: shared terms under Czech law, plus the Czech-only terms. */
export const CS: GlossaryTexts = {
  'vat-payer': {
    term: 'Plátce a neplátce DPH',
    aka: 'plátce daně z přidané hodnoty',
    definition:
      'Plátce DPH je osoba registrovaná k dani z přidané hodnoty, která k cenám svých plnění připočítává DPH, odvádí ji státu a může si nárokovat odpočet daně z nákupů. Neplátce DPH k cenám daň nepřipočítává a odpočet uplatnit nemůže.',
    explanation: [
      'Podle § 6 zákona o DPH se plátcem povinně stává ten, jehož obrat za kalendářní rok přesáhne 2 000 000 Kč, a to od 1. ledna následujícího roku. Kdo během roku přesáhne 2 536 500 Kč, je plátcem už ode dne následujícího po překročení. Registrovat se lze i dobrovolně; přihlášku upravuje § 94.',
      'Plátce vystavuje daňové doklady, podává přiznání k DPH a kontrolní hlášení. Neplátce vystavuje faktury bez DPH a DPH na ni uvést nesmí.',
      'Mezi oběma stavy stojí identifikovaná osoba: není plátcem, ale u některých služeb z jiných států EU musí daň přiznat a zaplatit.'
    ],
    example:
      'Grafička je plátce DPH. Za logo účtuje 10 000 Kč bez daně, na fakturu proto připíše 21 % DPH, tedy 2 100 Kč, a celkem fakturuje 12 100 Kč. Kdyby byla neplátce, fakturovala by jen 10 000 Kč.',
    match: ['plátc(?:e|i|em|ů|ům)? DPH', 'neplátc(?:e|i|em|ů)? DPH']
  },
  'vat-rate': {
    term: 'Sazba DPH',
    definition:
      'Sazba DPH je procento, kterým se ze základu daně vypočítá daň z přidané hodnoty. V Česku platí od 1. ledna 2024 základní sazba 21 % a snížená sazba 12 %, některá plnění jsou od daně osvobozena.',
    explanation: [
      'Která sazba se na plnění použije, určuje § 47 zákona o DPH a jeho přílohy. Základní sazba se použije vždy, když zákon nestanoví sníženou sazbu nebo osvobození.',
      'Na faktuře plátce se uvádí sazba u každé položky a rekapitulace daně podle sazeb. Při přenesení daňové povinnosti sazbu ani částku daně dodavatel neuvádí, daň dopočítá odběratel.'
    ],
    example: 'Kniha patří do snížené sazby 12 %, takže z ceny 500 Kč bez daně je DPH 60 Kč. Tisk letáků je v základní sazbě 21 %: z 500 Kč bez daně je DPH 105 Kč.',
    match: ['sazb(?:a|y|u|ou|ě) DPH']
  },
  'tax-base': {
    term: 'Základ daně (DPH)',
    definition:
      'Základ daně je částka, ze které se počítá DPH: vše, co plátce za plnění dostal nebo má dostat, bez samotné daně z přidané hodnoty.',
    explanation: [
      'Co do základu daně patří, určuje § 36 zákona o DPH. Patří do něj i vedlejší výdaje, které dodavatel zákazníkovi přeúčtuje, například dopravu nebo balné, a jiné daně a poplatky kromě DPH.',
      'U plnění v cizí měně se základ daně přepočítá na koruny kurzem podle zákona o DPH. Opravuje se opravným daňovým dokladem, ne přepsáním původní faktury.'
    ],
    example: 'Truhlář účtuje stůl za 20 000 Kč a dopravu za 1 000 Kč, obojí bez DPH. Základ daně je 21 000 Kč a DPH 21 % z něj činí 4 410 Kč.',
    match: ['základ(?:u|em)? daně']
  },
  invoice: {
    term: 'Faktura',
    definition:
      'Faktura je doklad, kterým dodavatel vyúčtuje odběrateli zboží nebo službu a vyzve ho k zaplacení. U plátce DPH je faktura zpravidla zároveň daňovým dokladem.',
    explanation: [
      'Každý podnikatel musí na faktuře, stejně jako na všech obchodních listinách, uvést své jméno nebo firmu, sídlo a IČO a podnikatel zapsaný ve veřejném rejstříku i údaj o zápisu (§ 435 občanského zákoníku).',
      'Plátce DPH vystavuje daňový doklad podle § 28 a § 29 zákona o DPH, který musí obsahovat další údaje, například DIČ obou stran, datum uskutečnění zdanitelného plnění a rozpis daně podle sazeb.',
      'Neplátce vystavuje fakturu bez DPH. Zákon o DPH se na ni nevztahuje, údaje podle občanského zákoníku ale uvést musí.'
    ],
    example:
      'Programátor neplátce vystaví fakturu na 30 000 Kč za vývoj webu. Uvede své jméno, adresu a IČO, údaje odběratele, popis práce, částku, datum splatnosti a číslo účtu.',
    match: ['faktur(?:a|y|u|ou|e|ách|ám|ami)']
  },
  'invoice-number': {
    term: 'Číslo faktury',
    aka: 'evidenční číslo daňového dokladu',
    definition:
      'Číslo faktury je jednoznačné označení dokladu v řadě dokladů vystavovatele. U plátce DPH je to povinné evidenční číslo daňového dokladu, které se v číselné řadě nesmí opakovat.',
    explanation: [
      'Zákon o DPH v § 29 odst. 1 požaduje evidenční číslo daňového dokladu, přidělené v jedné nebo více řadách, které zajistí, že je doklad jednoznačně identifikovatelný. Konkrétní formát si plátce zvolí sám.',
      'Číslo faktury se často používá i jako variabilní symbol platby, aby šla příchozí platba snadno spárovat s fakturou.'
    ],
    example: 'Řada 2026001, 2026002, 2026003 … je platná. Dvě různé faktury s číslem 2026002 v téže řadě platné nejsou.',
    match: ['čísl(?:o|a|em) faktury', 'evidenční(?:ho|m)? čísl(?:o|a|em)']
  },
  'advance-invoice': {
    term: 'Zálohová faktura',
    aka: 'proforma faktura',
    definition:
      'Zálohová faktura je výzva k zaplacení zálohy před dodáním zboží nebo služby. Sama o sobě není daňovým dokladem; plátce DPH vystavuje daňový doklad až k přijaté platbě.',
    explanation: [
      'Přijetím zálohy před dodáním vzniká plátci povinnost přiznat daň ke dni přijetí úplaty (§ 20a odst. 2 zákona o DPH). K přijaté záloze proto vystaví daňový doklad, zpravidla nazývaný daňový doklad k přijaté platbě.',
      'Po dodání se vystaví konečná faktura, ve které se přijatá záloha odečte. Neplátce řeší jen zaplacení: vystaví zálohovou fakturu a pak vyúčtování.'
    ],
    example:
      'Fotograf požádá o zálohu 5 000 Kč před svatbou a pošle zálohovou fakturu. Když záloha přijde, vystaví k ní daňový doklad. Po svatbě vyfakturuje celých 15 000 Kč a odečte zaplacených 5 000 Kč.',
    match: ['zálohov(?:á|é|ou) faktur(?:a|y|u|ou)', 'proforma faktur(?:a|y|u|ou)']
  },
  'credit-note': {
    term: 'Dobropis',
    aka: 'opravný daňový doklad',
    definition:
      'Dobropis je doklad, kterým dodavatel snižuje dříve vyfakturovanou částku, například při vrácení zboží, slevě nebo chybě. U plátce DPH jde o opravný daňový doklad, kterým se opravuje i základ daně a daň.',
    explanation: [
      'Opravu základu daně a výše daně upravuje § 42 zákona o DPH, náležitosti opravného daňového dokladu § 45. Doklad odkazuje na původní fakturu a uvádí rozdíl, ne novou celkovou částku.',
      'Původní faktura se nepřepisuje ani nemaže. Opačný doklad, který částku zvyšuje, se hovorově nazývá vrubopis.'
    ],
    example: 'Za dodané židle byla vyfakturována částka 12 100 Kč s DPH. Zákazník jednu židli vrátil, dodavatel proto vystaví dobropis na −2 420 Kč s DPH, který odkazuje na původní fakturu.',
    match: ['dobropis(?:u|em|y)?', 'opravn(?:ý|ého|ým) daňov(?:ý|ého|ým) doklad(?:u|em)?']
  },
  'reverse-charge': {
    term: 'Přenesená daňová povinnost',
    aka: 'reverse charge',
    definition:
      'Přenesená daňová povinnost je režim, ve kterém DPH nepřiznává dodavatel, ale odběratel. Dodavatel vystaví fakturu bez daně a odběratel daň sám vypočítá, přizná a obvykle si ji zároveň odečte.',
    explanation: [
      'V tuzemsku se režim týká jen plnění, která vyjmenovává zákon o DPH od § 92a, například stavebních a montážních prací (§ 92e) nebo dodání odpadu, a jen mezi plátci. Stejný princip platí u služeb a zboží mezi podnikateli z různých států EU.',
      'Faktura v tomto režimu obsahuje DIČ odběratele a sdělení, že daň odvede zákazník. Plnění v tuzemském režimu se uvádějí v kontrolním hlášení.'
    ],
    example:
      'Stavební firma plátce provede pro jiného plátce stavební práce za 100 000 Kč. Fakturuje 100 000 Kč bez DPH s poznámkou „daň odvede zákazník“. Odběratel si DPH 21 % dopočítá a přizná sám.',
    match: ['přenesen(?:á|é|ou|ém) daňov(?:á|é|ou|ém) povinnost(?:i)?', 'reverse charge']
  },
  'recapitulative-statement': {
    term: 'Souhrnné hlášení',
    definition:
      'Souhrnné hlášení je výkaz pro finanční úřad, ve kterém plátce nebo identifikovaná osoba uvádí dodání zboží a poskytnutí služeb podnikatelům v jiných státech EU. Údaje se porovnávají v celé EU přes systém VIES.',
    explanation: [
      'Povinnost podávat souhrnné hlášení upravuje § 102 zákona o DPH. Podává se elektronicky do 25 dnů po skončení měsíce, ve kterém plnění proběhlo; kdo poskytuje jen služby, může je podávat čtvrtletně.',
      'V hlášení se uvádí DIČ zahraničního odběratele, kód plnění a celková hodnota za období. Bez plnění do jiného státu EU se nepodává.'
    ],
    example: 'Překladatelka v březnu fakturovala služby německé a rakouské firmě. Do 25. dubna podá souhrnné hlášení s DIČ obou firem a hodnotou služeb za březen.',
    match: ['souhrnn(?:é|ého|ém|ým) hlášení']
  },
  'vat-return': {
    term: 'Přiznání k DPH',
    aka: 'daňové přiznání k dani z přidané hodnoty',
    definition:
      'Přiznání k DPH je formulář, ve kterém plátce za každé zdaňovací období uvede daň na výstupu a nárok na odpočet a vypočte daň k zaplacení nebo nadměrný odpočet.',
    explanation: [
      'Kdo přiznání podává, stanoví § 101 zákona o DPH. Podává se elektronicky do 25. dne po skončení zdaňovacího období a ve stejné lhůtě se daň platí. Připadne-li konec lhůty na víkend nebo svátek, posouvá se na nejbližší pracovní den.',
      'Spolu s přiznáním podává plátce kontrolní hlášení a případně souhrnné hlášení.'
    ],
    example: 'Plátce s měsíčním obdobím podává přiznání za září do 25. října. Daň na výstupu 42 000 Kč minus odpočet 15 000 Kč dává daň k zaplacení 27 000 Kč.',
    match: ['přiznání k DPH', 'daňov(?:é|ého|ém) přiznání k DPH']
  },
  'tax-period': {
    term: 'Zdaňovací období DPH',
    definition:
      'Zdaňovací období je úsek, za který plátce podává přiznání k DPH: kalendářní měsíc, nebo za zákonem stanovených podmínek kalendářní čtvrtletí.',
    explanation: [
      'Základním obdobím je měsíc (§ 99 zákona o DPH). Čtvrtletí si plátce může zvolit, pokud splní podmínky § 99a, mimo jiné obrat za předchozí rok nejvýše 15 000 000 Kč; změnu oznámí správci daně do konce ledna.',
      'Právnické osoby podávají kontrolní hlášení měsíčně i tehdy, když mají čtvrtletní období pro přiznání.'
    ],
    example: 'Plátce se čtvrtletním obdobím podává přiznání za červenec až září do 25. října. Plátce s měsíčním obdobím podává za každý měsíc zvlášť.',
    match: ['zdaňovací(?:ho|m)? obdob(?:í|ím)']
  },
  oss: {
    term: 'OSS',
    aka: 'One Stop Shop, zvláštní režim jednoho správního místa',
    definition:
      'OSS je režim, ve kterém podnikatel přiznává DPH z prodeje zboží a služeb spotřebitelům v jiných státech EU v jediném přiznání ve svém státě, místo aby se registroval v každém státě zvlášť.',
    explanation: [
      'Režim jednoho správního místa upravuje zákon o DPH od § 110a. U prodeje na dálku spotřebitelům v jiném státě EU se po překročení celounijního limitu platí DPH podle sazby státu zákazníka. OSS umožňuje tuto daň přiznat a zaplatit přes český finanční úřad.',
      'Do OSS se hlásí dobrovolně elektronicky. Přiznání se podává čtvrtletně a uvádí se v něm obrat a daň zvlášť pro každý stát.'
    ],
    example: 'E-shop z Brna prodává spotřebitelům na Slovensku a v Polsku. Po překročení limitu účtuje slovenským zákazníkům slovenskou DPH a polským polskou a obojí přizná v jednom čtvrtletním přiznání OSS.',
    match: ['\\bOSS\\b', 'One Stop Shop']
  },
  'e-invoice': {
    term: 'Elektronická faktura',
    aka: 'e-faktura',
    definition:
      'Elektronická faktura je faktura vystavená a doručená v elektronické podobě, například jako PDF nebo strukturovaný soubor (ISDOC, Peppol UBL). Strukturovanou fakturu umí účetní program načíst bez přepisování.',
    explanation: [
      'Zákon o DPH považuje elektronickou fakturu za rovnocennou papírové; daňový doklad v elektronické podobě lze použít se souhlasem odběratele (§ 26 odst. 3 zákona o DPH). Musí být zaručena věrohodnost původu, neporušenost obsahu a čitelnost.',
      'PDF je pro člověka, strukturovaný soubor pro stroj. V Česku se mezi firmami používá formát ISDOC, ve veřejné správě a v zahraničí síť Peppol.'
    ],
    example: 'Dodavatel pošle e-mailem PDF faktury a k němu soubor ISDOC. Účetní odběratele soubor naimportuje a údaje se do účetnictví doplní samy.',
    match: ['elektronick(?:á|é|ou) faktur(?:a|y|u|ou)', 'e-faktur(?:a|y|u|ou)']
  },
  peppol: {
    term: 'Peppol',
    definition:
      'Peppol je mezinárodní síť a soubor standardů pro výměnu elektronických faktur a dalších obchodních dokumentů mezi firmami a úřady. Faktura se posílá jako strukturovaný soubor ve formátu Peppol BIS (UBL) přes certifikované přístupové body.',
    explanation: [
      'Odesílatel i příjemce se do sítě připojují přes svého poskytovatele přístupového bodu a jsou v ní dohledatelní podle identifikátoru, obvykle DIČ nebo IČO. Formát Peppol BIS Billing 3.0 vychází z evropské normy EN 16931.',
      'Na Slovensku musí být od 1. ledna 2027 tuzemské faktury mezi podnikateli strukturované a doručují se přes certifikované doručovací služby, v praxi síť Peppol. V Česku je Peppol dobrovolný.'
    ],
    example: 'Česká firma fakturuje belgickému odběrateli. Místo PDF mu pošle fakturu přes Peppol a ta se mu objeví přímo v účetním systému.',
    match: ['\\bPeppol\\b']
  },
  'variable-symbol': {
    term: 'Variabilní symbol',
    aka: 'VS',
    definition:
      'Variabilní symbol je číslo až o deseti číslicích, které plátce uvede u bankovní platby, aby příjemce poznal, co platí. U faktury se jako variabilní symbol obvykle používá číslo faktury.',
    explanation: [
      'Variabilní symbol je zvyklost tuzemského platebního styku v Česku a na Slovensku, žádný daňový zákon ho na faktuře nevyžaduje. Bez něj ale dodavatel jen obtížně páruje příchozí platby.',
      'QR platba obsahuje variabilní symbol, takže ho odběratel nemusí opisovat. U plateb ze zahraničí se místo něj používá text pro příjemce (reference).'
    ],
    example: 'Faktura číslo 2026015 uvádí variabilní symbol 2026015. Odběratel ho zadá k platbě a dodavatelův program platbu sám spáruje s fakturou.',
    match: ['variabilní(?:ho|m)? symbol(?:u|em)?']
  },
  'due-date': {
    term: 'Datum splatnosti',
    aka: 'splatnost faktury',
    definition:
      'Datum splatnosti je den, do kterého má odběratel fakturu zaplatit. Po jeho uplynutí je v prodlení a dodavatel může požadovat úrok z prodlení.',
    explanation: [
      'Splatnost si strany mohou dohodnout. Když dohodnutá není, může věřitel žádat zaplacení ihned a dlužník musí zaplatit bez zbytečného odkladu (§ 1958 odst. 2 občanského zákoníku). Mezi podnikateli platí lhůta delší než 60 dnů jen tehdy, když je výslovně ujednaná a vůči věřiteli není hrubě nespravedlivá (§ 1963).',
      'Peníze jsou včas zaplacené, když jsou ke dni splatnosti připsané na účet věřitele, ne když je dlužník odešle.'
    ],
    example: 'Faktura vystavená 1. června se splatností 14 dnů je splatná 15. června. Pokud platba přijde 18. června, je odběratel tři dny v prodlení.',
    match: ['dat(?:um|a|em) splatnosti', 'splatnost(?:i)?']
  },
  'late-payment-interest': {
    term: 'Úrok z prodlení',
    definition:
      'Úrok z prodlení je částka, kterou dlužník platí věřiteli navíc za každý den, kdy je s placením faktury po splatnosti. Jeho výši stanoví nařízení vlády, pokud si strany nedohodly jinou.',
    explanation: [
      'Nárok na úrok z prodlení dává § 1970 občanského zákoníku. Věřitel ho nemusí uplatnit; pokud ho chce, vyčíslí ho v upomínce nebo zvláštní faktuře.'
    ],
    example: 'Odběratel zaplatí fakturu se zpožděním 20 dnů. Dodavatel mu pošle upomínku, ve které vyčíslí úrok z prodlení za těchto 20 dnů ze dlužné částky.',
    match: ['úro(?:k|ku|kem|ky) z prodlení']
  },
  iban: {
    term: 'IBAN',
    aka: 'mezinárodní číslo bankovního účtu',
    definition:
      'IBAN je mezinárodní formát čísla bankovního účtu, který začíná kódem země a dvěma kontrolními číslicemi. Český IBAN má 24 znaků: CZ, kontrolní číslice, kód banky, předčíslí a číslo účtu.',
    explanation: [
      'IBAN se používá u plateb v eurech v rámci SEPA, u plateb ze zahraničí a v QR platbě. Kontrolní číslice odhalí většinu překlepů dřív, než platba odejde.',
      'Na faktuře je vhodné uvést tuzemské číslo účtu i IBAN, aby mohli zaplatit odběratelé z Česka i ze zahraničí.'
    ],
    example: 'Účet 19-2000145399/0800 má IBAN CZ65 0800 0000 1920 0014 5399. Mezery slouží jen pro čitelnost.',
    match: ['\\bIBAN\\b']
  },
  'qr-payment': {
    term: 'QR platba',
    aka: 'QR Platba (SPAYD), na Slovensku PAY by square',
    definition:
      'QR platba je QR kód na faktuře, který obsahuje číslo účtu, částku, variabilní symbol a další údaje k platbě. Odběratel ho naskenuje v mobilní bance a nic nepřepisuje.',
    explanation: [
      'V Česku se používá formát QR Platba (SPAYD) podle standardu České bankovní asociace, na Slovensku formát PAY by square. Oba umí české i slovenské banky přečíst, ale každý trh preferuje svůj.',
      'QR kód není povinnou náležitostí faktury. Zrychluje ale placení a omezuje chyby v čísle účtu a variabilním symbolu.'
    ],
    example: 'Faktura na 8 470 Kč má v rohu QR kód. Zákazník ho naskenuje, banka mu předvyplní účet, částku i variabilní symbol a on jen potvrdí platbu.',
    match: ['QR plat(?:ba|by|bu|bou)', 'PAY by square']
  },
  vies: {
    term: 'VIES',
    aka: 'VAT Information Exchange System',
    definition:
      'VIES je systém Evropské komise pro ověření, zda je DIČ podnikatele z jiného státu EU platné pro obchody v rámci EU. Přes VIES si státy také předávají údaje ze souhrnných hlášení.',
    explanation: [
      'Před vystavením faktury v režimu přenesení daňové povinnosti do jiného státu EU je vhodné ověřit DIČ odběratele ve VIES. Neplatné DIČ znamená, že odběratel pro účely DPH není registrovaný.',
      'Výsledek ověření s datem je dobré si uložit jako důkaz, že dodavatel jednal v dobré víře.'
    ],
    example: 'Grafik fakturuje rakouské agentuře. Ve VIES ověří její DIČ ATU12345678, systém ho potvrdí jako platné a grafik vystaví fakturu bez české DPH.',
    match: ['\\bVIES\\b']
  },
  'exchange-rate': {
    term: 'Kurz pro přepočet cizí měny',
    aka: 'kurz ČNB',
    definition:
      'U faktury v cizí měně se základ daně a DPH přepočítávají na koruny kurzem devizového trhu vyhlášeným Českou národní bankou. Rozhoduje kurz ke dni vzniku povinnosti přiznat daň.',
    explanation: [
      'Přepočet cizí měny pro účely DPH upravuje § 4 odst. 8 zákona o DPH. Místo kurzu ČNB lze použít i poslední kurz zveřejněný Evropskou centrální bankou.',
      'Fakturu lze vystavit v eurech nebo jiné měně, daň na ní ale musí být uvedena i v korunách.'
    ],
    example: 'Plátce fakturuje 1 000 € bez DPH, DUZP je 10. března a kurz ČNB k tomu dni je 25,00 Kč/€. Základ daně je 25 000 Kč a DPH 21 % je 5 250 Kč.',
    match: ['kurz(?:u|em)? ČNB']
  },
  dic: {
    term: 'DIČ',
    aka: 'daňové identifikační číslo',
    definition:
      'DIČ je daňové identifikační číslo, které přiděluje finanční úřad. V Česku má tvar CZ a 8 až 10 číslic; u právnických osob je číselná část obvykle shodná s IČO.',
    explanation: [
      'DIČ přiděluje správce daně při registraci k dani. Mít DIČ neznamená být plátcem DPH: DIČ mají i neplátci registrovaní k dani z příjmů.',
      'Plátce uvádí na daňovém dokladu své DIČ a u plnění pro jiného plátce i DIČ odběratele. Platnost DIČ ze zemí EU ověří VIES.'
    ],
    example: 'Firma s IČO 12345678 má DIČ CZ12345678. Jako plátce ho uvádí na každé faktuře.',
    match: ['\\bDIČ\\b']
  },
  ico: {
    term: 'IČO',
    aka: 'identifikační číslo osoby',
    definition:
      'IČO je osmimístné identifikační číslo, které jednoznačně označuje podnikatele, firmu nebo jinou osobu v registrech státu. Uvádí se na fakturách a všech obchodních listinách.',
    explanation: [
      'IČO se přiděluje při vzniku firmy nebo zahájení podnikání a během existence se nemění. Podle IČO lze dohledat podnikatele ve veřejném registru ARES.',
      'IČO je údaj pro identifikaci, ne pro daně. Pro daně slouží DIČ.'
    ],
    example: 'Ve fakturačním programu stačí zadat IČO odběratele a název i adresa se doplní z registru ARES.',
    match: ['\\bIČO\\b']
  },
  'flat-rate-expenses': {
    term: 'Výdajový paušál',
    aka: 'paušální výdaje',
    definition:
      'Výdajový paušál je způsob, jak si OSVČ odečte od příjmů výdaje stanoveným procentem místo skutečných nákladů. Procento závisí na druhu činnosti.',
    explanation: [
      'Paušální výdaje upravuje § 7 odst. 7 zákona o daních z příjmů, včetně procent pro jednotlivé činnosti a horní hranice, ze které se paušál počítá.',
      'Paušál šetří evidenci výdajů, ale může vyjít hůř než skutečné výdaje, pokud má podnikatel vysoké náklady. Uplatňuje se v daňovém přiznání za celý rok.'
    ],
    example: 'Řemeslník s příjmy 800 000 Kč a paušálem 80 % si odečte výdaje 640 000 Kč a daň platí ze zbylých 160 000 Kč.',
    match: ['výdajov(?:ý|ého|ým) paušál(?:u|em)?', 'paušální(?:ch|mi)? výdaj(?:e|ů|ích|i)']
  },

  // Czech-only terms.
  'taxable-supply-date': {
    term: 'DUZP',
    aka: 'datum uskutečnění zdanitelného plnění',
    definition:
      'DUZP je den, kdy plátce DPH dodal zboží nebo poskytl službu, případně přijal úplatu, pokud přišla dřív. K tomuto dni vzniká povinnost přiznat daň a podle něj se určuje období, do kterého plnění patří.',
    explanation: [
      'Povinnost přiznat daň ke dni uskutečnění plnění, nebo ke dni přijetí úplaty, pokud přišla dřív, stanoví § 20a zákona o DPH. Kdy je plnění uskutečněné, určuje § 21: u zboží zpravidla dnem dodání, u služby dnem poskytnutí nebo dnem vystavení daňového dokladu, podle toho, co nastane dřív. Daňový doklad musí plátce vystavit do 15 dnů ode dne, kdy mu povinnost přiznat daň vznikla (§ 28 odst. 8).',
      'DUZP se uvádí na daňovém dokladu a nemusí se shodovat s datem vystavení. Neplátce DUZP na fakturu neuvádí.'
    ],
    example: 'Instalatér dokončil práci 28. března a fakturu vystaví 2. dubna. DUZP je 28. března, takže daň patří do přiznání za březen.',
    match: ['\\bDUZP\\b', 'dat(?:um|a|em) uskutečnění zdanitelného plnění']
  },
  'tax-document': {
    term: 'Daňový doklad',
    definition:
      'Daňový doklad je doklad, který plátce DPH vystavuje o zdanitelném plnění a který slouží odběrateli k uplatnění odpočtu daně. Musí obsahovat náležitosti podle § 29 zákona o DPH.',
    explanation: [
      'Druhy daňových dokladů a způsob jejich vystavení upravují § 26 a § 28 zákona o DPH, obsah § 29. Patří mezi ně běžný daňový doklad, zjednodušený daňový doklad a opravný daňový doklad.',
      'Mezi povinné údaje patří mimo jiné evidenční číslo, DIČ dodavatele a odběratele, rozsah plnění, datum vystavení, DUZP, základ daně, sazba a výše daně. Pokud jsou splněny, může se doklad jmenovat i „faktura“.'
    ],
    example: 'Faktura plátce s nadpisem „Faktura – daňový doklad“, číslem, DUZP, DIČ obou stran a rekapitulací DPH podle sazeb je daňový doklad.',
    match: ['daňov(?:ý|ého|ým|ém) doklad(?:u|em|y)?']
  },
  'simplified-tax-document': {
    term: 'Zjednodušený daňový doklad',
    definition:
      'Zjednodušený daňový doklad je daňový doklad s menším počtem údajů, který lze vystavit, pokud celková částka na dokladu nepřesáhne 10 000 Kč. Typicky je to účtenka z obchodu.',
    explanation: [
      'Zjednodušený daňový doklad upravuje § 30 zákona o DPH. Nemusí obsahovat údaje o odběrateli a místo základu a výše daně stačí cena včetně daně a sazba.',
      'Nelze jej vystavit například u plnění v režimu přenesení daňové povinnosti nebo u dodání zboží do jiného státu EU.'
    ],
    example: 'Kavárna plátce vystaví na kávu a dort za 180 Kč účtenku s DIČ, datem, cenou s DPH a sazbou. To je zjednodušený daňový doklad.',
    match: ['zjednodušen(?:ý|ého|ým) daňov(?:ý|ého|ým) doklad(?:u|em)?']
  },
  'control-statement': {
    term: 'Kontrolní hlášení',
    aka: 'KH',
    definition:
      'Kontrolní hlášení je výkaz plátce DPH s údaji o vystavených a přijatých daňových dokladech, podle kterého finanční správa páruje plnění mezi dodavateli a odběrateli. Podává se elektronicky spolu s přiznáním nebo měsíčně.',
    explanation: [
      'Povinnost podávat kontrolní hlášení upravuje § 101c zákona o DPH, lhůty § 101e: fyzická osoba je podává za stejné období jako přiznání, právnická osoba vždy měsíčně, a to do 25. dne po skončení období.',
      'Doklady nad 10 000 Kč včetně DPH se uvádějí jednotlivě s DIČ protistrany, menší souhrnně. Nepodání nebo opožděné podání je spojeno s pokutami.'
    ],
    example: 'Plátce v říjnu vystavil fakturu za 60 000 Kč jinému plátci a přijal fakturu za nájem 24 200 Kč. Obě uvede jednotlivě v kontrolním hlášení za říjen, které podá do 25. listopadu.',
    match: ['kontrolní(?:ho|m)? hlášení']
  },
  'identified-person': {
    term: 'Identifikovaná osoba',
    definition:
      'Identifikovaná osoba je podnikatel, který není plátcem DPH, ale je registrovaný k DPH kvůli službám nebo zboží z jiných států EU. Z takových nákupů musí DPH přiznat a zaplatit, odpočet ale nemá.',
    explanation: [
      'Kdy se osoba stává identifikovanou osobou, stanoví § 6g až 6l zákona o DPH. Typicky jde o neplátce, který nakoupí službu od podnikatele z jiného státu EU (reklamu, software, služby platforem), nebo poskytne službu podnikateli v jiném státě EU.',
      'Identifikovaná osoba podává přiznání k DPH jen za měsíce, ve kterých takové plnění měla, a souhrnné hlášení, pokud službu do EU poskytla. Na svých tuzemských fakturách dál DPH neúčtuje.'
    ],
    example: 'Neplátce koupí reklamu od irské společnosti za 2 000 Kč. Stává se identifikovanou osobou, z reklamy přizná DPH 21 %, tedy 420 Kč, a zaplatí ji finančnímu úřadu.',
    match: ['identifikovan(?:á|é|ou) osob(?:a|y|u|ou)']
  },
  'flat-tax': {
    term: 'Paušální daň',
    aka: 'paušální režim',
    definition:
      'Paušální daň je jedna měsíční platba, kterou OSVČ v paušálním režimu hradí daň z příjmů, sociální a zdravotní pojištění najednou. Nepodává daňové přiznání ani přehledy pro pojišťovny.',
    explanation: [
      'Paušální režim upravuje § 2a a § 7a zákona o daních z příjmů. Je určen OSVČ, které nejsou plátci DPH a mají příjmy do zákonného limitu; výše platby závisí na pásmu podle příjmů a druhu činnosti.',
      'Do režimu se vstupuje oznámením správci daně. Částky jednotlivých pásem se mění každý rok, aktuální spočítá kalkulačka paušální daně.'
    ],
    example: 'Grafik neplátce s příjmy do hranice prvního pásma platí každý měsíc jednu částku na účet finančního úřadu a po skončení roku nepodává přiznání.',
    match: ['paušální(?:ho|m)? (?:daň|daně|daní|režim(?:u|em)?)']
  },
  isdoc: {
    term: 'ISDOC',
    definition:
      'ISDOC je český formát elektronické faktury ve formě souboru XML, který umí načíst většina tuzemských účetních programů. Používá se mezi firmami i ve veřejné správě.',
    explanation: [
      'Formát vytvořilo sdružení dodavatelů účetního softwaru. Soubor ISDOC se posílá samostatně nebo jako příloha PDF faktury (ISDOCX), takže fakturu může číst člověk i program.',
      'Na rozdíl od Peppolu není ISDOC síť, ale jen formát dat. Zákon ho nepředepisuje; elektronická faktura může mít libovolný formát, pokud s ní odběratel souhlasí.'
    ],
    example: 'Odběratel požaduje faktury v ISDOC. Dodavatel ho přiloží k e-mailu s PDF a účetní ho jedním kliknutím naimportuje do účetnictví.',
    match: ['\\bISDOC\\b']
  },
  'unreliable-payer': {
    term: 'Nespolehlivý plátce',
    definition:
      'Nespolehlivý plátce je plátce DPH, kterého finanční úřad označil za nespolehlivého, protože závažně porušil své povinnosti ve správě DPH. Kdo mu zaplatí, může ručit za jeho nezaplacenou daň.',
    explanation: [
      'Označení nespolehlivého plátce upravuje § 106a zákona o DPH, ručení odběratele § 109. Seznam nespolehlivých plátců i zveřejněných bankovních účtů je veřejně v registru plátců DPH.',
      'Ručení hrozí i tehdy, když odběratel zaplatí na účet, který plátce nezveřejnil, a částka přesáhne zákonný limit. Před větší platbou je proto dobré dodavatele v registru ověřit.'
    ],
    example: 'Firma před zaplacením faktury za 150 000 Kč ověří dodavatele v registru plátců. Zjistí, že je nespolehlivý plátce, a DPH uhradí přímo jeho finančnímu úřadu, aby za ni neručila.',
    match: ['nespolehliv(?:ý|ého|ým|í) plátc(?:e|em|i)']
  },
  'self-employed': {
    term: 'OSVČ',
    aka: 'osoba samostatně výdělečně činná',
    definition:
      'OSVČ je fyzická osoba, která podniká nebo vykonává jinou samostatnou výdělečnou činnost, typicky na živnostenský list. Platí si sama daň z příjmů a zálohy na sociální a zdravotní pojištění.',
    explanation: [
      'Příjmy OSVČ ze samostatné činnosti zdaňuje § 7 zákona o daních z příjmů. Výdaje může uplatnit skutečné, nebo paušálem, případně může zvolit paušální daň.',
      'Kromě daně platí OSVČ zálohy na pojištění. Jejich minimální výši každý rok stanoví zákon a po skončení roku podává přehledy pro správu sociálního zabezpečení a zdravotní pojišťovnu.'
    ],
    example: 'Účetní na živnostenský list je OSVČ. Každý měsíc platí zálohy na pojištění a po skončení roku podá přiznání a přehledy.',
    match: ['\\bOSVČ\\b']
  },
  'data-box': {
    term: 'Datová schránka',
    aka: 'ISDS',
    definition:
      'Datová schránka je elektronické úložiště pro doručování úředních dokumentů mezi státem, firmami a občany. Zpráva doručená do datové schránky má stejné účinky jako doporučený dopis do vlastních rukou.',
    explanation: [
      'Firmy zapsané v obchodním rejstříku i podnikající fyzické osoby mají datovou schránku zřízenou ze zákona. Kdo ji má, podává daňová přiznání a hlášení elektronicky.',
      'Přiznání k DPH a kontrolní hlášení lze odeslat přes datovou schránku jako soubor XML nebo přes daňový portál MOJE daně.'
    ],
    example: 'Plátce vyexportuje z fakturačního programu přiznání k DPH ve formátu XML a odešle ho finančnímu úřadu přes svou datovou schránku.',
    match: ['datov(?:á|é|ou) schránk(?:a|y|u|ou)']
  }
};
