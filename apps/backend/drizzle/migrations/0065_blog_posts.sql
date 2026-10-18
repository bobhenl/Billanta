-- Blog behind /blog. GLOBAL table (no tenant, no RLS) like partners: the
-- articles are Billanta's own content, managed by platform admins
-- (PLATFORM_ADMIN_EMAILS) through /api/v1/admin/blog. AI only ever writes
-- drafts (status pending_review); publishing is a human click.
--
-- Seeds the Slovak e-invoicing 2027 article in sk, cs and en as
-- pending_review, so it goes live only after someone has read it.
CREATE TABLE IF NOT EXISTS "blog_posts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "locale" varchar(2) NOT NULL,
  "slug" varchar(100) NOT NULL,
  "translation_key" varchar(100) NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "body" text NOT NULL,
  "kind" varchar(16) NOT NULL DEFAULT 'manual',
  "status" varchar(16) NOT NULL DEFAULT 'draft',
  "sources" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "facts" text,
  "warnings" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "published_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "blog_posts_locale_check" CHECK ("locale" IN ('cs', 'sk', 'en')),
  CONSTRAINT "blog_posts_status_check" CHECK ("status" IN ('draft', 'pending_review', 'published', 'rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "blog_posts_locale_slug_unique" ON "blog_posts" ("locale", "slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blog_posts_published_idx" ON "blog_posts" ("locale", "published_at") WHERE "status" = 'published';
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "blog_posts" TO faktur_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO "blog_posts" ("locale", "slug", "translation_key", "title", "description", "body", "kind", "status", "sources")
VALUES
(
  'sk',
  'slovakia-e-invoicing-2027',
  'slovakia-e-invoicing-2027',
  'Povinná e-faktúra na Slovensku od 1. januára 2027: čo to znamená pre živnostníkov a malé firmy',
  'Od roku 2027 musia platitelia DPH na Slovensku posielať tuzemské faktúry ako štruktúrované e-faktúry cez sieť Peppol a e-faktúru musí vedieť prijať každý podnikateľ. Čo sa mení a ako sa pripraviť.',
  $body$Od 1. januára 2027 sa na Slovensku mení spôsob, akým si firmy posielajú faktúry. Platitelia DPH usadení v SR budú faktúry za tuzemské dodania vyhotovovať ako štruktúrovanú elektronickú faktúru a posielať ich cez certifikovaného poskytovateľa. PDF poslané e-mailom už na tieto účely nebude stačiť.

## Čo sa presne mení

- **Vystavovanie:** platiteľ DPH usadený v SR vyhotoví faktúru za tuzemské dodanie tovaru alebo služby ako elektronický dokument podľa európskej normy EN 16931. Takú faktúru spracuje softvér bez prepisovania.
- **Prijímanie:** od rovnakého dátumu musí e-faktúru vedieť prijať každá právnická osoba aj každá fyzická osoba, ktorá podniká. Týka sa to aj neplatiteľov DPH.
- **Doručovanie:** faktúry putujú cez sieť Peppol. Vstupnou bránou je certifikovaný poskytovateľ (prístupový bod), ktorého si firma vyberie zo zoznamu Finančnej správy. Údaje z faktúr dostáva aj Finančná správa SR.
- **Formát:** PDF ani EDIFACT pri tuzemských transakciách definíciu elektronickej faktúry na účely DPH nesplnia.

## Rok 2026 je dobrovoľný

Do konca roka 2026 je zapojenie dobrovoľné. Je to dobrý čas vybrať si poskytovateľa, vyskúšať odoslanie aj prijatie faktúry a dohodnúť sa s účtovníkom, ako sa budú faktúry dostávať do účtovníctva.

## Čo bude ďalej

Cezhraničné faktúry v rámci EÚ prídu na rad neskôr. Európsky balík ViDA počíta s povinnou elektronickou fakturáciou pri cezhraničných dodaniach od roku 2030.

## Čo spraviť už teraz

- Overte si, či ste platiteľ DPH. Ak áno, od 1. januára 2027 sa vás týka vystavovanie aj prijímanie e-faktúr.
- Ak platiteľ nie ste, pripravte sa aspoň na prijímanie e-faktúr od dodávateľov.
- Vyberte si poskytovateľa zo zoznamu Finančnej správy alebo fakturačný program, ktorý sa na poskytovateľa napojí.
- Skontrolujte si údaje odberateľov, najmä IČO a IČ DPH. Bez správnych údajov e-faktúru nedoručíte.

## Ako s tým pomôže Billanta

Billanta už dnes vie každú vystavenú faktúru stiahnuť vo formáte UBL podľa Peppol BIS Billing 3.0, z ktorého slovenské e-faktúry vychádzajú. Napojenie na certifikovaného poskytovateľa pripravujeme, aby ste e-faktúry mohli posielať priamo z aplikácie. Keď bude hotové, napíšeme o tom tu na blogu.

## Na čo si dať pozor

Tento článok je zhrnutie, nie právna rada. Povinnosť zaviedla novela zákona o DPH (zákon č. 222/2004 Z. z.), prijatá ako zákon č. 385/2025 Z. z., a Finančná správa pravidlá priebežne spresňuje vo svojich otázkach a odpovediach. Presné znenie si overte v zákone na Slov-Lexe a v najnovších FAQ na stránke Finančnej správy.$body$,
  'manual',
  'pending_review',
  '[{"title":"Finančná správa SR: eFaktúra, otázky a odpovede","url":"https://www.financnasprava.sk/_img/pfsedit/Dokumenty_PFS/Zverejnovanie_dok/Aktualne/DPH/2026/2026.08.26_009_DPH_2025_IM_FaQ_eFaktura.pdf.pdf"},{"title":"Slov-Lex: zákon č. 385/2025 Z. z.","url":"https://static.slov-lex.sk/pdf/SK/ZZ/2025/385/ZZ_2025_385_20260101.pdf"},{"title":"Slov-Lex: zákon č. 222/2004 Z. z. o dani z pridanej hodnoty","url":"https://www.slov-lex.sk/ezbierky/pravne-predpisy/SK/ZZ/2004/222/"}]'::jsonb
),
(
  'cs',
  'slovakia-e-invoicing-2027',
  'slovakia-e-invoicing-2027',
  'Povinná e-faktura na Slovensku od 1. ledna 2027: co to znamená pro české firmy se slovenskými odběrateli',
  'Od roku 2027 musí plátci DPH na Slovensku posílat tuzemské faktury jako strukturované e-faktury přes síť Peppol. Co se mění, koho se to týká a co z toho plyne pro české dodavatele.',
  $body$Od 1. ledna 2027 zavádí Slovensko povinnou elektronickou fakturaci. Plátci DPH usazení na Slovensku budou faktury za tuzemská plnění vystavovat jako strukturovaný elektronický doklad a posílat je přes certifikovaného poskytovatele. Pro české firmy je to důležité hlavně tehdy, když mají slovenskou pobočku, registraci k DPH na Slovensku nebo slovenské dodavatele.

## Co se mění

- **Vystavování:** plátce DPH usazený na Slovensku vystaví fakturu za tuzemské dodání zboží nebo služby jako elektronický dokument podle evropské normy EN 16931. Takovou fakturu zpracuje software bez přepisování.
- **Přijímání:** od stejného data musí e-fakturu umět přijmout každá právnická osoba i každá podnikající fyzická osoba na Slovensku, tedy i neplátci DPH.
- **Doručování:** faktury putují přes síť Peppol. Vstupní branou je certifikovaný poskytovatel (přístupový bod) ze seznamu slovenské Finanční správy, která údaje z faktur také dostává.
- **Formát:** PDF poslané e-mailem ani EDIFACT definici elektronické faktury pro účely slovenské DPH u tuzemských plnění nesplní.

## Týká se to faktur z Česka na Slovensko?

Povinnost se zatím týká tuzemských plnění na Slovensku. Faktury českého dodavatele slovenskému odběrateli jsou přeshraniční a ty mají přijít na řadu až s evropským balíkem ViDA, který počítá s povinnou e-fakturací přeshraničních plnění od roku 2030. Slovenský odběratel ale může už dřív chtít fakturu ve strukturované podobě, protože ji tak bude zpracovávat.

## Rok 2026 je dobrovolný

Do konce roku 2026 je zapojení na Slovensku dobrovolné. Firmy si v tomto období vybírají poskytovatele a zkoušejí odesílání i příjem.

## Co udělat teď

- Pokud jste registrovaní k DPH na Slovensku nebo tam máte provozovnu, ověřte si, jestli se vás povinnost týká.
- Zeptejte se slovenských odběratelů, v jaké podobě budou od roku 2027 chtít faktury.
- Zkontrolujte si v kontaktech IČO a DIČ (na Slovensku IČ DPH) odběratelů.

## Jak pomůže Billanta

Billanta umí každou vystavenou fakturu stáhnout ve formátu UBL podle Peppol BIS Billing 3.0, ze kterého slovenské e-faktury vycházejí. Napojení na certifikovaného poskytovatele připravujeme. Až bude hotové, napíšeme o tom tady na blogu.

## Na co si dát pozor

Článek je shrnutí, ne právní rada. Povinnost zavedla novela slovenského zákona o DPH (zákon č. 222/2004 Z. z.), přijatá jako zákon č. 385/2025 Z. z., a slovenská Finanční správa pravidla průběžně upřesňuje ve svých otázkách a odpovědích. Přesné znění si ověřte na Slov-Lexu a na stránkách Finanční správy SR.$body$,
  'manual',
  'pending_review',
  '[{"title":"Finančná správa SR: eFaktúra, otázky a odpovede","url":"https://www.financnasprava.sk/_img/pfsedit/Dokumenty_PFS/Zverejnovanie_dok/Aktualne/DPH/2026/2026.08.26_009_DPH_2025_IM_FaQ_eFaktura.pdf.pdf"},{"title":"Slov-Lex: zákon č. 385/2025 Z. z.","url":"https://static.slov-lex.sk/pdf/SK/ZZ/2025/385/ZZ_2025_385_20260101.pdf"},{"title":"Slov-Lex: zákon č. 222/2004 Z. z. o dani z pridanej hodnoty","url":"https://www.slov-lex.sk/ezbierky/pravne-predpisy/SK/ZZ/2004/222/"}]'::jsonb
),
(
  'en',
  'slovakia-e-invoicing-2027',
  'slovakia-e-invoicing-2027',
  'Mandatory e-invoicing in Slovakia from 1 January 2027: what small businesses need to know',
  'From 2027, VAT payers established in Slovakia must send domestic invoices as structured e-invoices over the Peppol network, and every business must be able to receive them. What changes and how to prepare.',
  $body$From 1 January 2027 Slovakia makes electronic invoicing mandatory. VAT payers established in Slovakia will issue invoices for domestic supplies as structured electronic documents and send them through a certified provider. A PDF sent by email will no longer count as an invoice for these supplies.

## What changes

- **Issuing:** a VAT payer established in Slovakia issues the invoice for a domestic supply of goods or services as an electronic document following the European standard EN 16931, which software can process without retyping.
- **Receiving:** from the same date every legal entity and every self-employed person in Slovakia must be able to receive e-invoices, including businesses that are not VAT payers.
- **Delivery:** invoices travel over the Peppol network. The entry point is a certified provider (access point) from the list kept by the Slovak Financial Administration, which also receives the invoice data.
- **Format:** neither PDF nor EDIFACT meets the definition of an electronic invoice for Slovak VAT on domestic supplies.

## 2026 is voluntary

Until the end of 2026 taking part is voluntary. It is a good time to choose a provider, test sending and receiving, and agree with your accountant how invoices will reach the books.

## What comes next

Cross-border invoices within the EU follow later. The EU ViDA package makes e-invoicing mandatory for cross-border supplies from 2030.

## What to do now

- Check whether you are a VAT payer in Slovakia. If you are, both issuing and receiving apply to you from 1 January 2027.
- If you are not, get ready at least to receive e-invoices from your suppliers.
- Choose a provider from the Financial Administration's list, or an invoicing app that connects to one.
- Check your customers' company and VAT numbers. Without correct details an e-invoice cannot be delivered.

## How Billanta helps

Billanta already lets you download every issued invoice as UBL following Peppol BIS Billing 3.0, the format Slovak e-invoices build on. We are working on a connection to a certified provider so you can send e-invoices straight from the app, and will announce it here when it is ready.

## A word of caution

This article is a summary, not legal advice. The obligation was introduced by an amendment to the Slovak VAT Act (Act No. 222/2004 Coll.), passed as Act No. 385/2025 Coll., and the Financial Administration keeps refining the rules in its FAQ. Check the exact wording on Slov-Lex and in the latest FAQ on the Financial Administration's website.$body$,
  'manual',
  'pending_review',
  '[{"title":"Finančná správa SR: eFaktúra, otázky a odpovede","url":"https://www.financnasprava.sk/_img/pfsedit/Dokumenty_PFS/Zverejnovanie_dok/Aktualne/DPH/2026/2026.08.26_009_DPH_2025_IM_FaQ_eFaktura.pdf.pdf"},{"title":"Slov-Lex: zákon č. 385/2025 Z. z.","url":"https://static.slov-lex.sk/pdf/SK/ZZ/2025/385/ZZ_2025_385_20260101.pdf"},{"title":"Slov-Lex: zákon č. 222/2004 Z. z. o dani z pridanej hodnoty","url":"https://www.slov-lex.sk/ezbierky/pravne-predpisy/SK/ZZ/2004/222/"}]'::jsonb
)
ON CONFLICT ("locale", "slug") DO NOTHING;
