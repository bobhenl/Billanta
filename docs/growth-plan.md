# Billanta: plán růstu na 30 dní

Stav k 2026-10-18 (založeno 2026-10-17). Plán počítá s jedním člověkem a AI asistentem. Pořadí je
dané tím, co rychle přinese návštěvy z vyhledávání a co dál běží samo.

Hlavní zásady (poučení z `VoxelRank/docs/seo-audit-2026-09.md`):

- Google odměňuje stránky, které mají vlastní data nebo vlastní obsah.
  Šablona, ve které se mění jen název, je riziko (scaled content / doorway pages).
- Tenká stránka odpovídá 200 s `noindex,follow` a nepatří do sitemapy.
- Žádné prázdné `ItemList`/FAQ markupy. Strukturovaná data jen tam, kde
  odpovídají viditelnému obsahu.
- Titulek do 60 znaků, popis do 155. Interní odkazy vedou na stránky, které
  mají rankovat.
- Automatizujeme generování a kontrolu. Co je v rozporu s pravidly platformy
  (boti v komunitách), neautomatizujeme.

## Co už máme

| Plocha | Stav | Poznámka |
|---|---|---|
| `/create-invoice` (faktura bez registrace) | hotovo | nejsilnější vstupní stránka, priorita 0.9 |
| `/features/*` | hotovo | stránky funkcí |
| `/compare` | hotovo | jedna tabulka s 5 konkurenty (`lib/competitors.ts`) |
| `/compare/<značka>` | hotovo | Billanta vs Fakturoid, iDoklad, SuperFaktúra, Vyfakturuj, BitFaktura |
| `/calculators/*` | hotovo | QR platba, firma podle IČO, IBAN, splatnost (bez registrace) |
| karta doporučení | hotovo | v dashboardu po první zaplacené faktuře |
| `/invoicing/[slug]` | hotovo | ~9 000 obcí CZ/SK, každá indexovaná jen ve svém jazyce |
| `/for-accountants`, `/partners` | hotovo | |
| `robots.ts` | hotovo | AI crawlery povolené, `/*?` zakázané (podle VoxelRanku) |
| sitemap | hotovo | po 2 000 URL v souboru |
| `/guides/*` | částečně | návody bez blogu a bez auto-draftů |
| blog | chybí | |

## Týden 1: SEO základy a měření

1. **Search Console a Bing Webmaster** pro `billanta.cz` (nebo finální doménu):
   ověřit doménu, poslat všechny shardy sitemapy a zapnout IndexNow
   (VoxelRank: `services/indexnow.js`).
2. **Audit stránek obcí.** 9 000 stránek je největší riziko i příležitost.
   Domluveno: nejdřív indexovat jen největší obce, každou s vlastními
   formulacemi, ne šablonou s vyměněným názvem. Menší přidávat, až se
   velké zaindexují.
   - Po 2 týdnech v Search Console zjistit, kolik je „Procházeno, neindexováno“.
   - Indexovat jen obce, kde má stránka opravdu vlastní data: finanční
     úřad, okolní obce a ideálně i počet firem nebo živnostníků z ARES/RPO.
     Ostatní nechat `noindex,follow` a vyřadit ze sitemapy.
   - Začít třeba s okresními městy a obcemi nad 2 000 obyvatel. Rozšiřovat
     podle dat ze Search Console.
3. **Technické položky z auditu VoxelRanku:**
   - HSTS v Caddy;
   - `llms.txt` s popisem produktu a odkazy na hlavní stránky;
   - kontrola délky titulků a popisů;
   - LCP obrázek na úvodní stránce bez lazy loadingu.
4. **Test strukturovaných dat:** každá indexovaná stránka musí mít JSON-LD a
   žádné prázdné seznamy. Kontrolu spustit ve vitestu nad vykreslenými
   stránkami (VoxelRank to tak má).

## Týden 1–2: veřejné nástroje (programmatic SEO s vlastní hodnotou)

**Hotovo:** QR platba, firma podle IČO, IBAN a splatnost (`4b8bb80`).
Zbývají ostatní řádky tabulky.

Každý nástroj je samostatná stránka pod `/calculators/<slug>`
(registr `lib/public-tools.ts`). Má krátký návod a
vlastní FAQ, nástroj funguje i bez registrace a na konci nabízí „Udělat z toho
fakturu v Billantě“. Logika už je hotová v `packages/cz-compliance`.

| Nástroj | Hledá se | Zdroj v kódu |
|---|---|---|
| Generátor QR platby (QR Platba / Pay by square) | „qr platba generátor“ | `spayd.ts`, `qr-faktura.ts` |
| Vyhledání firmy podle IČO (ARES / RPO) | „ares ičo“, „vyhledat firmu podle ičo“ | `ares-client.ts`, `rpo-client.ts` |
| Ověření spolehlivého plátce DPH a účtu | „nespolehlivý plátce dph“ | `vat-status.ts` |
| Převod čísla účtu na IBAN, kontrola účtu | „převod na iban“ | `bank-account-validator.ts` |
| Kalkulačka splatnosti a pracovních dnů | „datum splatnosti“, „pracovní dny“ | `working-days.ts`, `public-holidays.ts` |
| Daňový kalendář | „daňový kalendář 2027“ | `tax-deadlines.ts` |
| Kontrola náležitostí faktury | „náležitosti faktury“ | `invoice-requirements.ts`, `law-links.ts` |
| Prohlížeč ISDOC (nahraj soubor, uvidíš fakturu) | „isdoc prohlížeč“ | `isdoc-generator.ts` (parser doplnit) |
| Kalkulačka DPH (s DPH ↔ bez DPH) | „kalkulačka dph“ | jednoduché, napsat nově |

Rate limit a `x-guest-ip` jako u `/create-invoice`. Do sitemapy, do
patičky a do vyhledávání na webu.

## Týden 2: srovnání vlastními slovy

**Hotovo** (`48bff5b`): stránky `/compare/<značka>` se stejnými buňkami
jako hlavní tabulka. Mají titulek „Alternativa k X“, FAQ a postup přechodu.
Chybí ještě přepočet ceny při 10, 50 a 200 fakturách.

- `/compare/[slug]`: stránka „Billanta vs Fakturoid“ pro každou značku
  z `lib/competitors.ts`.
- Text píšeme sami. Zdrojem jsou jen veřejné ceníky (`pricingUrl`) a naše
  vlastní testování. Nic nekopírujeme. Ke každé stránce uvedeme datum
  srovnání (`COMPARED_AT`).
- Struktura stránky:
  - pro koho je která aplikace lepší, férově, i tam, kde vyhrává konkurent;
  - rozdíly v ceně při 10, 50 a 200 fakturách měsíčně;
  - jak přejít (import);
  - FAQ.
- Plus stránky „Alternativa k X“, které míří na dotazy typu
  „fakturoid alternativa“.

## Týden 2–3: obsah, který se píše sám (s pojistkami)

Model podle VoxelRanku (`services/contentDrafts.js`): AI napíše koncept
z našich vlastních dat a ze zákonů. Automatické kontroly ho buď schválí,
nebo zastaví a čeká na člověka.

**Témata:**

- Návody k nástrojům a k funkcím.
- Změny legislativy: sazby DPH, limity, e-fakturace na Slovensku od 2027.
- „Jak vystavit fakturu pro …“ podle oboru (`lib/business-presets.ts`).
- Daňové termíny tento měsíc, generované z `tax-deadlines.ts`.

**Automatické blokátory**, při kterých se koncept nepublikuje a čeká na
schválení:

- Číslo nebo datum, které není ve vstupních datech (sazba, limit, termín).
- Odkaz na paragraf, který není v `law-links.ts`.
- Zakázané fráze („garantujeme“, „vždy“, „nikdy nemusíte“) a slib daňové úspory.
- Krátký nebo useknutý text, chybějící zdroj.
- Téma zákona, který se mění. Tam má přednost vždy ruční kontrola.

**Riziko:** chybná daňová informace poškodí důvěru víc, než jí jeden článek
přidá. Proto auto-publish jen pro typy obsahu, kde všechna fakta pocházejí
z našich dat (termíny, návody k nástrojům). Legislativní články jdou do
fronty ke schválení jedním klikem. Strop 2–3 články týdně, protože víc
Google bere jako hromadně generovaný obsah.

Admin přepínač „auto-publish“ zvlášť pro každý typ, stejně jako ve VoxelRanku.

## Týden 3: sociální sítě a videa automaticky

**Autoposter** (VoxelRank `routes/socialadmin.js`, `services/social/*`):

- Fronta příspěvků: nový článek, nový nástroj, daňový termín za 3 dny.
- Sítě: zatím Facebook stránka a LinkedIn. Instagram, Threads, Bluesky
  a X později.
- Rozpočet příspěvků na každou síť zvlášť a pauza při chybě
  (`social/pause.js`).

**Krátká videa** (VoxelRank `services/shorts.js` a GitHub Action `shorts.yml`):

1. Web naplánuje téma a AI napíše scénář.
2. GitHub Action:
   - Playwright nahraje obrazovku demo účtu (vystavení faktury za 20 s,
     QR platba, hlasová faktura z Telegramu);
   - TTS namluví komentář v češtině nebo slovenštině;
   - ffmpeg z toho složí video 9:16.
3. Hotové MP4 se nahraje na web a odtud jde na **YouTube Shorts
   a Facebook**. Na tom jsme se domluvili.

TikTok zatím nejde, protože vyžaduje schválení aplikace. VoxelRank
napoprvé neprošel kvůli „personal use“, viz `docs/tiktok-audit.md`.
Instagram (Reels) přidáme, až bude účet připravený.

Formáty videí: „faktura za 20 sekund“, „3 chyby na faktuře, kvůli kterým
nedostanete zaplaceno“, „daňový termín tento týden“.

## Průběžně: katalogy, partneři, komunity

**Katalogy:** seznam s odkazy, šablony e-mailů a zprávu pro účetní najdeš
v [catalogs-and-outreach.md](catalogs-and-outreach.md). Je tam i to,
kam jde zdarma zapsat VoxelRank.

- Software katalogy (Capterra, G2, AlternativeTo, Product Hunt, SaaSHub…)
  adresu nepotřebují.
- Firmy.cz, Google Business a Zoznam/Azet adresu potřebují. Billanta ji
  zatím nemá, řešením je virtuální sídlo.

**Partnerské stránky** (Pohoda, Money S3, Fio API, Raiffeisen, KB):

- většinou vyžadují partnerství nebo aspoň e-mail; ten napíšeme, odešle
  ho člověk;
- export do Pohody nebo Money je náš argument: „funguje s vaším účetním“.

**Komunity:** facebookové skupiny živnostníků, r/czech a r/Slovakia,
Modrý koník, Živnostník.cz.

- Boti a automatické odpovědi porušují pravidla všech těchto komunit
  a vedou k banu.
- Poloautomat: monitor klíčových slov (RSS/API, kde to jde) pošle odkaz
  do Telegramu, AI navrhne odpověď a člověk ji upraví a odešle.
  Odpověď musí pomoct sama o sobě a odkaz přidat jen tam, kde je opravdu
  k věci.

## Produkt jako kanál

- **Doporučení po první zaplacené faktuře.** V aplikaci se ukáže karta
  „Pozvi kolegu, oba dostanete kredit“ (`lib/referral.ts`). Uvnitř
  aplikace je to v pořádku. E-mailem jen se souhlasem nebo stávajícím
  zákazníkům s odkazem na odhlášení (GDPR, zákon 480/2004 Sb.).
- **Patička „Vystaveno v Billantě“** ve faktuře a v e-mailu na free plánu.
  Je to nejlevnější virální smyčka u fakturace.
- **Účetní:** program `/for-accountants`. Jeden účetní přivede 10–50
  klientů. Zpráva k oslovení je v `catalogs-and-outreach.md`.
- **Adresář účetních** na stránkách obcí: účetní se zapíšou sami a obce
  tím dostanou vlastní obsah. Až po vyřešení moderace a souhlasu.
- **Affiliate v %** (až poběží placení):
  - 30 % z první platby pro affiliate partnery, 50 % pro účetní;
  - výplata až po lhůtě pro vrácení peněz a od minimální částky;
  - partner nám vystaví fakturu;
  - nejde o čistý zisk, z platby odchází DPH, poplatky, AI a server.
  - Dnešní kredity zůstávají pro běžná doporučení.

## Slovensko 2027

- Slovensko zavádí povinnou elektronickou fakturaci mezi firmami
  (B2B, formát podle EN 16931, přes Peppol). Podle veřejných zdrojů platí
  pro tuzemské B2B a B2G od 1. 1. 2027 a pro přeshraniční plnění od 2030.
  Faktury půjdou přes certifikované přístupové body a data dostane
  Finanční správa. Odkazy na zákon se ve zdrojích liší, před publikací
  ověřit na financnasprava.sk a v zákoně o DPH 222/2004 Z. z.
- **Obsah:** sekce „E-fakturace 2027“ na `/sk`, návod, kontrolní seznam,
  odpočet dní a newsletter „dáme vědět, až se něco změní“.
- **Produkt:** UBL export už máme (`ubl-generator.ts`). Doplnit validaci
  podle EN 16931 a připojení na Peppol (přes přístupový bod partnera).
- Kampaň začít už teď: dotazů přibývá a konkurence zatím má málo obsahu.

## Měření

Každý týden 15 minut:

- Search Console: kliky, zobrazení a indexované stránky podle sekcí
  (nástroje, srovnání, obce, blog);
- registrace podle zdroje (UTM, referral cookie);
- počet faktur vystavených bez registrace a kolik z nich vede k registraci.

Co za 30 dní nepřinese nic, ani zobrazení, se přepracuje nebo vypne.

## Pořadí implementace

1. ~~Veřejné nástroje: QR platba, IČO/ARES, IBAN, splatnost.~~ Hotovo.
2. ~~`/compare/[slug]` vlastními slovy.~~ Hotovo.
3. ~~Karta doporučení po první zaplacené faktuře.~~ Hotovo.
4. Blog: článek o SK e-fakturaci 2027 a infrastruktura pro auto-drafty.
5. Indexace jen největších obcí, s vlastními formulacemi.
6. HSTS, `llms.txt`, test JSON-LD.
7. Další audit obcí podle Search Console.
8. Autoposter (FB, LinkedIn).
9. Videa (GitHub Action, Shorts a FB).
