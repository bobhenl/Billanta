# Smlouva o zpracování osobních údajů – Billanta pro školy (NÁVRH)

> **Pracovní návrh, ne hotový právní text.** Text připravil AI asistent,
> ne advokát. Před zveřejněním ho musí přečíst pověřenec (DPO) některé
> školy, nejlépe i advokát. Verze návrhu: `classroom-dpa-0.2`
> (2026-10-21). Posouzení z pohledu pověřence školy je
> v `docs/classroom-dpo-review.md`; slovenské znění v
> `docs/classroom-dpa-draft.sk.md`.

### Co je ještě potřeba doplnit nebo ověřit

Hranaté závorky `[...]` zůstaly jen tam, kde údaj neznáme:

| Údaj | Kde | Kdo doplní |
|---|---|---|
| obchodní firma / jméno, IČO, sídlo a zápis v rejstříku provozovatele | §1 | provozovatel |
| kontaktní e-mail a e-mail pro bezpečnostní incidenty | §1, §7 | provozovatel |
| adresa veřejného seznamu dalších zpracovatelů | §6.1 | provozovatel |
| smluvní subjekt a lokalita hostingu (IP serveru patří OVH Hosting, Inc., Kanada; plán je přesun do EU) | §6.4, příloha 2 | provozovatel |
| typ Google účtu pro zálohy (Workspace s Cloud DPA, nebo jiné úložiště) a region | příloha 2 | provozovatel |
| region odesílání u Resend | příloha 2 | provozovatel |
| zda je v produkci nastaveno šifrování záloh (`BACKUP_AGE_RECIPIENT`) | příloha 1 | provozovatel (hodnotu nevypisovat) |
| zabezpečení přístupu provozovatele k serveru (SSH klíče, 2FA u poskytovatele) | příloha 1 | provozovatel |
| omezení odpovědnosti vůči Škole | §9.1 | rozhodnutí provozovatele po konzultaci |

**Podmínky, bez kterých tuto smlouvu nelze nabídnout školám:** provoz přes
HTTPS, vyplněná identita provozovatele, potvrzení smlouvy statutárním
orgánem školy (ne jen kliknutím učitele) a pravdivě vyplněná příloha 2.
Podrobně viz `docs/classroom-dpo-review.md`, oddíl 9.

---

Uzavřená podle čl. 28 nařízení Evropského parlamentu a Rady (EU) 2016/679
(dále „GDPR“) a zákona č. 110/2019 Sb., o zpracování osobních údajů.

## 1. Smluvní strany

**Správce:** škola uvedená v žádosti o školní režim (název, IČO a sídlo
podle rejstříku škol a školských zařízení), zastoupená ředitelem nebo
ředitelkou, případně osobou, kterou k tomu škola písemně pověřila (dále
„Škola“).

**Zpracovatel:** [obchodní firma / jméno provozovatele], IČO [...], se
sídlem [...], zapsaný v [rejstřík], kontaktní e-mail [...], provozovatel
služby Billanta (dále „Billanta“).

1.1 Za Školu smlouvu potvrzuje její **statutární orgán** (ředitel) nebo
osoba, kterou ředitel písemně pověřil. Potvrzení probíhá elektronicky:
Billanta pošle odkaz na oficiální e-mail Školy, ředitel si smlouvu přečte
a potvrdí ji. Škola může místo toho poslat podepsané PDF, dokument
s elektronickým podpisem nebo zprávu z datové schránky.

1.2 Učitelé Školy pak v Billantě zakládají a vedou třídy **v rámci pověření
Školy**. Učitel při žádosti prohlašuje, že na Škole učí. Sám smlouvu
neuzavírá ani nemění.

1.3 Škola v žádosti uvede kontaktní e-mail Školy a, má-li ho, e-mail svého
pověřence pro ochranu osobních údajů. Na tyto adresy Billanta posílá
oznámení podle této smlouvy.

## 2. Předmět, povaha a účel zpracování

2.1 Billanta poskytuje Škole službu „školní režim“: výukové prostředí,
ve kterém žáci a studenti (dále „Žáci“) vystavují cvičné doklady
v cvičných firmách s fiktivními údaji a učitelé sledují jejich postup.

2.2 Povaha zpracování: uložení, zobrazení, úprava a výmaz údajů, které
Žáci a učitelé zadají do aplikace; zobrazení postupu třídy učitelům;
zálohování; výmaz po skončení třídy.

2.3 Osobní údaje se zpracovávají **jen za účelem výuky** v předmětech,
které Škola určí, a jen po dobu podle oddílu 4. Billanta je nepoužije
k marketingu, profilování, prodeji, tréninku modelů umělé inteligence ani
k jiným vlastním účelům (čl. 28 odst. 10 GDPR). Statistiky používání
služby smí vytvářet jen z anonymních souhrnných údajů.

## 3. Kategorie subjektů a údajů

| Subjekt | Údaje | Čeho se netýká |
|---|---|---|
| Žáci | přezdívka (2–30 znaků; Škola Žáky poučí, že nemá obsahovat celé jméno); obsah cvičné firmy (doklady, kontakty, náklady, výkazy času a další záznamy, které Žák zadá); osobní kód pro opětovné přihlášení (uložený jako otisk HMAC a zašifrovaný); technické údaje (datum vytvoření, poslední aktivita, přihlašovací relace, počet neúspěšných pokusů o přihlášení na úrovni třídy) | Billanta od Žáků nežádá e-mail, telefon, heslo, datum narození, fotografii ani adresu. IP adresa se neukládá: k ochraně proti zneužití slouží jen v operační paměti po dobu nejvýše přibližně 10 minut. |
| Učitelé Školy | jméno, e-mail, škola, předmět, nastavení tříd, záznamy o krocích ve třídě | Vlastní učitelský účet (přihlášení, předplatné) zpracovává Billanta jako správce podle svých zásad ochrany osobních údajů. |
| Třetí osoby v cvičných firmách | údaje, které Žák do firmy zadá nebo načte z veřejného rejstříku (ARES a obdobné registry); u podnikajících fyzických osob jde o jejich jméno a adresu | Cvičné firmy jsou fiktivní; viz 3.1. |

3.1 Škola zajistí, aby Žáci do cvičných firem nezadávali skutečné osobní
údaje třetích osob mimo veřejné rejstříky ani zvláštní kategorie údajů
(čl. 9 a 10 GDPR). Doporučujeme pracovat s fiktivními údaji nebo
s právnickými osobami.

## 4. Doba zpracování a výmaz

4.1 Údaje Žáků se zpracovávají po dobu trvání třídy. Třída končí
standardně 31. srpna a konec lze nastavit nejvýše 13 měsíců dopředu.
Učitel může třídu prodloužit, vždy nejvýše o 13 měsíců ode dne
prodloužení. Učitel dostane upozornění 30 a 7 dní před koncem třídy.

4.2 Po skončení třídy jsou cvičné firmy 30 dní jen ke čtení a potom se
automaticky smažou. Odebrání Žáka učitelem jeho firmu a údaje smaže
ihned. Smazání třídy, nebo zrušení účtu učitele, který třídu vlastní,
smaže všechny firmy třídy ihned.

4.3 Před smazáním může učitel stáhnout přehled postupu třídy a doklady
cvičných firem. Tím je splněna povinnost údaje vrátit (čl. 28 odst. 3
písm. g) GDPR); Billanta údaje jinak nevrací.

4.4 Smazané údaje zůstávají v zašifrovaných zálohách nejdéle **60 dní**
(místní kopie na serveru 14 dní). Ze záloh se neobnovují do provozu,
pokud to nevyžaduje obnova celé služby po havárii; v tom případě Billanta
znovu provede výmazy, o kterých ví.

## 5. Povinnosti Billanty

5.1 Billanta:

a) zpracovává osobní údaje jen na doložené pokyny Školy, a to i pokud jde
   o předání do třetích zemí. Pokyny jsou tato smlouva a nastavení třídy,
   která učitelé Školy provádějí v aplikaci. Předání mimo EU/EHP je
   povoleno jen podle oddílu 6.4. Ukládá-li Billantě zpracování právo EU
   nebo členského státu, informuje Školu předem, pokud to právo
   nezakazuje;

b) zajistí, aby osoby oprávněné zpracovávat osobní údaje byly zavázány
   k mlčenlivosti nebo jí byly povinny ze zákona, a aby měly přístup jen
   v rozsahu nezbytném pro provoz a podporu služby;

c) přijme technická a organizační opatření podle čl. 32 GDPR popsaná
   v příloze 1 a bude je udržovat na úrovni odpovídající stavu techniky.
   Opatření smí měnit jen tak, aby se úroveň ochrany nesnížila;

d) zapojí další zpracovatele jen podle oddílu 6;

e) s ohledem na povahu zpracování pomůže Škole plnit povinnost reagovat na
   žádosti subjektů údajů (čl. 15 až 22 GDPR). Většinu žádostí může učitel
   vyřídit přímo v aplikaci (zobrazení a export firmy, opravy záznamů,
   odebrání Žáka). Ostatní Billanta vyřídí podle pokynu Školy do 10
   pracovních dnů. Žádost, kterou dostane přímo od Žáka nebo rodiče,
   předá Škole bez zbytečného odkladu a sama na ni věcně neodpoví;

f) pomůže Škole plnit povinnosti podle čl. 32 až 36 GDPR (zabezpečení,
   ohlašování a oznamování porušení, posouzení vlivu, předchozí
   konzultace), s ohledem na povahu zpracování a informace, které má.
   Na požádání poskytne podklady pro posouzení vlivu (DPIA);

g) po skončení zpracování údaje smaže podle oddílu 4, pokud právo EU nebo
   členského státu nevyžaduje jejich uložení;

h) poskytne Škole informace potřebné k doložení splnění povinností podle
   čl. 28 GDPR a umožní audit nebo kontrolu prováděnou Školou nebo
   auditorem, kterého Škola pověří a který je vázán mlčenlivostí.
   Přednostně písemnými odpověďmi a dokumentací; kontrolu na místě po
   předchozí dohodě v přiměřeném termínu, nejvýše jednou ročně, pokud
   nejde o kontrolu po porušení zabezpečení nebo na pokyn dozorového
   úřadu;

i) Školu neprodleně upozorní, pokud podle jejího názoru pokyn porušuje
   GDPR nebo jiné předpisy o ochraně osobních údajů, a o každé žádosti
   orgánu veřejné moci o přístup k údajům Žáků, pokud to právo nezakazuje;

j) vede záznamy o činnostech zpracování podle čl. 30 odst. 2 GDPR a na
   požádání je zpřístupní Škole nebo dozorovému úřadu.

5.2 Billanta nesmí údaje Žáků zpřístupnit jiným uživatelům služby
s výjimkou učitelů dané třídy, kterým je Škola určila.

## 6. Další zpracovatelé a předání mimo EU

6.1 Škola uděluje obecné povolení k zapojení dalších zpracovatelů
uvedených v příloze 2. Aktuální seznam je také na [URL seznamu
zpracovatelů].

6.2 O zamýšleném přidání nebo nahrazení dalšího zpracovatele Billanta
informuje Školu e-mailem na kontakty podle 1.3 nejméně **30 dní předem**.
Škola může do konce této lhůty vznést odůvodněnou námitku. Pokud se strany
nedohodnou, může Škola smlouvu bez sankce ukončit ke dni změny; Billanta
pak třídy Školy ukončí a údaje smaže podle oddílu 4.

6.3 Billanta uloží každému dalšímu zpracovateli smlouvou stejné povinnosti
ochrany údajů, jaké má podle této smlouvy, zejména záruky podle 5.1 c).
Za plnění jeho povinností odpovídá Škole, jako by šlo o její vlastní.

6.4 Údaje Žáků se zpracovávají v EU/EHP nebo v zemi, o které Evropská
komise rozhodla, že zajišťuje odpovídající úroveň ochrany (čl. 45 GDPR).
Předání jinam je přípustné jen se zárukami podle kapitoly V GDPR
(standardní smluvní doložky nebo certifikace podle rámce EU–USA pro
ochranu osobních údajů) a, u záloh, jen v podobě zašifrované tak, že
příjemce nemá klíč. Kde údaje fyzicky jsou, uvádí příloha 2.

## 7. Porušení zabezpečení osobních údajů

7.1 Billanta ohlásí Škole porušení zabezpečení, které se týká údajů Žáků
nebo učitelů Školy, **bez zbytečného odkladu, nejpozději do 48 hodin od
okamžiku, kdy se o něm dozvěděla**. Ohlášení jde e-mailem na kontakty
podle 1.3 a učiteli, který třídu vlastní; kopii lze poslat do datové
schránky Školy.

7.2 Ohlášení obsahuje informace podle čl. 33 odst. 3 GDPR, které jsou
v tu chvíli známé (povaha porušení, kategorie a přibližný počet Žáků
a záznamů, pravděpodobné důsledky, přijatá a navržená opatření, kontakt).
Další informace Billanta doplňuje průběžně, jakmile je zjistí.

7.3 Billanta bez prodlení přijme opatření ke zmírnění následků, poskytne
Škole součinnost při ohlášení dozorovému úřadu (Úřad pro ochranu osobních
údajů) a při oznámení Žákům a rodičům. Sama dozorovému úřadu ani
subjektům údajů za Školu nic neohlašuje, pokud ji o to Škola nepožádá.

7.4 Kontakt pro bezpečnostní incidenty: [e-mail pro incidenty].

## 8. Povinnosti a práva Školy

Škola:

a) odpovídá za to, že zpracování má právní základ. U veřejných škol jde
   zpravidla o plnění úkolu ve veřejném zájmu podle čl. 6 odst. 1 písm. e)
   GDPR ve spojení se zákonem č. 561/2004 Sb. (školský zákon). Souhlas
   Žáků ani rodičů se nevyžaduje;

b) informuje Žáky a u nezletilých i jejich zákonné zástupce podle čl. 13
   GDPR; může použít vzor v příloze 3;

c) poučí Žáky, aby jako přezdívku nepoužívali celé jméno a do cvičných
   firem nezadávali skutečné osobní údaje (viz 3.1);

d) určí, kteří učitelé smí třídy zakládat, a oznámí Billantě, když některý
   učitel přestane být oprávněn (např. odejde ze Školy);

e) zajistí, aby učitelé chránili osobní kódy Žáků, které vidí, a nepoužívali
   je k přihlášení za Žáka;

f) má právo kdykoli dávat Billantě pokyny ke zpracování, ukončit třídu
   a požadovat výmaz údajů.

## 9. Odpovědnost, trvání a ukončení

9.1 Odpovědnost vůči subjektům údajů se řídí čl. 82 GDPR a nelze ji
smluvně omezit. [Omezení odpovědnosti Billanty vůči Škole, např. do výše
X Kč, s výjimkou úmyslu a hrubé nedbalosti: k rozhodnutí.]

9.2 Smlouva se uzavírá na dobu neurčitou a trvá, dokud má Škola
v Billantě třídu, včetně doby podle oddílu 4.

9.3 Kterákoli strana ji může vypovědět e-mailem s účinností ke konci
kalendářního měsíce, ve kterém výpověď došla. Účinností výpovědi se třídy
Školy ukončí a údaje se smažou podle oddílu 4; povinnosti podle oddílů 4,
5.1 b), 7 a 9.1 trvají až do úplného výmazu, včetně záloh.

9.4 Služba je pro školy zdarma. Obchodní podmínky Billanty se použijí, jen
pokud tato smlouva nestanoví jinak; v otázkách ochrany osobních údajů má
vždy přednost tato smlouva.

## 10. Závěrečná ustanovení

10.1 Smlouva se uzavírá v elektronické podobě (čl. 28 odst. 9 GDPR).
Billanta uchovává záznam o jejím potvrzení (verze textu, datum a čas,
jméno a funkce osoby, která ji za Školu potvrdila, a e-mail, ze kterého
to učinila) a na požádání pošle Škole PDF.

10.2 Novou verzi smlouvy Billanta Škole pošle nejméně 30 dní před
účinností; pokud Škola nesouhlasí, může smlouvu vypovědět podle 9.3.
Změny, které ochranu údajů jen zlepšují, mohou platit dříve.

10.3 Smlouva se řídí právem České republiky. Uzavírá-li ji slovenská
škola, platí slovenské znění a právo Slovenské republiky.

10.4 Smlouva nepodléhá uveřejnění v registru smluv, protože je
bezúplatná (zákon č. 340/2015 Sb.). [Ověřit s pověřencem.]

---

## Příloha 1 – technická a organizační opatření

Popis odpovídá stavu kódu k 2026-10-21. Položky označené **[podmínka]**
musí platit dřív, než se služba nabídne školám.

**Oddělení a řízení přístupu**

- Data každé cvičné firmy jsou oddělena na úrovni databáze (row-level
  security v PostgreSQL). Aplikace se k databázi připojuje rolí, která
  toto oddělení nemůže obejít. Operace přes více firem (vstup do třídy,
  odebrání Žáka, výmaz třídy) běží jen přes úzce vymezené databázové
  funkce.
- Učitelé třídy mají do firem Žáků přístup **jen ke čtení**. Ostatní
  uživatelé služby nemají přístup žádný.
- Nastavení cvičných firem (moduly, zařazení do třídy) nelze z aplikace
  změnit; počet záznamů ve firmě je omezen.
- Cvičné firmy nemohou odeslat e-mail, platbu ani veřejný odkaz, nemají
  napojení na banku, API, webhooky ani funkce AI a nelze je převést na
  skutečný účet.
- Pracovníci provozovatele přistupují k produkčnímu serveru jen
  k provozu a podpoře. [Doplnit: přístup jen přes SSH klíče, dvoufázové
  ověření u poskytovatele hostingu, okruh osob s přístupem.]

**Přihlašování**

- Žáci nemají heslo ani e-mail. Do třídy vstupují kódem třídy
  a přezdívkou; pro návrat dostanou osobní kód (8 znaků). Ten je uložen
  jako otisk HMAC-SHA256 a zvlášť zašifrovaný AES-256-GCM, aby ho učitel
  mohl Žákovi znovu ukázat. Učitel může kód přegenerovat; tím se ukončí
  všechna přihlášení Žáka.
- Po 10 chybných kódech ve třídě se návrat do třídy na 15 minut zablokuje.
  Počet pokusů z jedné IP adresy je omezen; IP adresa se k tomu používá
  jen v operační paměti a neukládá se.
- Přihlášení Žáka platí nejvýše 14 dní a nikdy déle než do výmazu firmy.
- Hesla učitelů jsou uložena jen jako otisk (bcrypt); učitel se může
  přihlašovat přes Google. Dvoufázové ověření je pro učitele dostupné.

**Šifrování a provoz**

- **[podmínka]** Veškerý provoz přes HTTPS (TLS). K 2026-10-21 běží
  produkce na adrese bez TLS; školám se služba nenabídne, dokud to
  neplatí.
- Osobní kódy Žáků jsou uloženy šifrovaně; tajné klíče aplikace jsou
  mimo databázi.
- Zálohy databáze se tvoří denně a před odesláním mimo server se šifrují
  nástrojem `age` veřejným klíčem; soukromý klíč drží provozovatel offline
  a mimo server. **[podmínka]** [Ověřit, že je šifrování záloh v produkci
  zapnuté.] Kopie na serveru se uchovávají 14 dní, mimo server 60 dní.
- Logy kontejnerů se rotují podle velikosti (nejvýše 3 × 10 MB na službu);
  webový server pro Billantu nevede přístupový log.
- Mezipaměť (Redis) neukládá data na disk.

**Minimalizace a výmaz**

- Od Žáků se nesbírá nic kromě přezdívky a toho, co zadají do cvičné firmy.
- Na stránkách vstupu do třídy a v aplikaci nejsou analytické ani reklamní
  nástroje. Analytika (Microsoft Clarity) je jen na marketingových
  stránkách a jen se souhlasem.
- Výmaz po skončení třídy probíhá automaticky (kontrola každých 15 minut).
  Učitel dostane upozornění 30 a 7 dní před koncem třídy.
- Odebrání Žáka nebo smazání třídy maže data ihned.

**Organizace**

- Školy schvaluje pracovník provozovatele ručně; ten při schválení nevidí
  přezdívky Žáků.
- Smlouvy s dalšími zpracovateli obsahují povinnosti podle čl. 28 GDPR.
- Postup při porušení zabezpečení: zjištění, omezení dopadu, ohlášení
  Škole do 48 hodin (oddíl 7), záznam o incidentu.

## Příloha 2 – další zpracovatelé

| Zpracovatel | Účel | Umístění dat | Týká se Žáků? | Právní nástroj předání |
|---|---|---|---|---|
| [smluvní subjekt OVH, ověřit] | virtuální server: aplikace, databáze, místní zálohy | [lokalita datacentra; podle IP rozsahu Kanada, OVH Hosting, Inc. Plánován přesun do EU.] | ano | Kanada: rozhodnutí Komise o odpovídající ochraně 2002/2/ES; v EU nepotřeba |
| Google (Google Workspace, [ověřit edici a region]) | uložení zašifrovaných záloh databáze | [EU, pokud je nastaven datový region; jinak celosvětově včetně USA] | ano, jen zašifrovaně bez klíče | Cloud Data Processing Addendum; EU–US Data Privacy Framework, náhradně standardní smluvní doložky |
| Resend | e-maily učitelům (schválení školy, upozornění na konec třídy) | [region odesílání, ověřit] | ne, Žáci nemají e-mail | DPA Resend; EU–US Data Privacy Framework nebo SCC [ověřit] |
| Google (přihlášení Google) | přihlášení učitele, pokud ho zvolí | celosvětově | ne | jako výše |

Plánované, zatím nezapojené: **Cloudflare** (CDN a ukončení TLS; uvidí
provoz včetně údajů Žáků). Před zapojením bude Škola informována podle
oddílu 6.2.

Ve školním režimu se nepoužívají poskytovatelé AI, platební brány,
chatovací aplikace ani analytika.

## Příloha 3 – vzor informace pro Žáky a rodiče

Škola může text upravit a zveřejnit (např. v systému školy nebo na webu).

> **Cvičné firmy v Billantě**
>
> V hodinách [předmět] používáme aplikaci Billanta. Každý žák v ní má
> cvičnou firmu s vymyšlenými údaji a učí se vystavovat faktury a vést
> doklady.
>
> **Kdo za údaje odpovídá:** [název školy], [adresa], kontakt
> [e-mail školy]; pověřenec pro ochranu osobních údajů: [jméno, e-mail].
> Aplikaci provozuje [provozovatel] jako náš zpracovatel na základě
> smlouvy.
>
> **Co se o žákovi ukládá:** jen přezdívka, kterou si žák zvolí (nemá to
> být celé jméno), a to, co zadá do své cvičné firmy. Nechceme e-mail,
> telefon ani heslo. Učitel vidí cvičné firmy žáků a jejich postup.
>
> **Proč:** jde o součást výuky podle školního vzdělávacího programu
> (čl. 6 odst. 1 písm. e) GDPR, školský zákon). Souhlas proto
> nepotřebujeme.
>
> **Jak dlouho:** po dobu trvání třídy, obvykle do konce školního roku
> (učitel ji může prodloužit). Pak jsou firmy 30 dní jen ke čtení
> a smažou se.
> Ze záloh zmizí nejpozději do 60 dní.
>
> **Kde:** na serveru v [země]; zálohy jsou šifrované.
>
> **Vaše práva:** můžete požádat o přístup k údajům, jejich opravu nebo
> výmaz a vznést námitku. Obraťte se na učitele nebo na pověřence školy.
> Stížnost můžete podat Úřadu pro ochranu osobních údajů (www.uoou.cz).
>
> **Prosíme:** do cvičné firmy nezadávejte skutečné osobní údaje svoje ani
> jiných lidí.

---

## K revizi (pro pověřence školy)

Úplné posouzení je v `docs/classroom-dpo-review.md`. Otevřené body:

1. **Potvrzení smlouvy ředitelem.** Návrh počítá s potvrzením kliknutím
   z oficiálního e-mailu Školy (oddíl 1.1). Stačí to, nebo je potřeba
   podepsané PDF či datová schránka? Aplikace zatím ukládá souhlas
   u učitele a nesbírá kontakt na Školu ani pověřence; to se musí změnit.
2. **Právní základ.** Čl. 6 odst. 1 písm. e) a školský zákon bez souhlasu
   rodičů; čl. 8 GDPR se neuplatní, protože nejde o souhlas ani o službu
   nabízenou přímo dítěti.
3. **Hosting mimo EU.** Server je podle IP adresy v Kanadě (rozhodnutí
   o odpovídající ochraně). Doporučení: přesun do EU regionu OVH.
4. **Zálohy na Google.** Jen Google Workspace se smlouvou o zpracování,
   ideálně s datovým regionem EU, nebo úložiště v EU. Zálohy jsou
   šifrované klíčem, který Google nemá. Soukromý Google účet nepřichází
   v úvahu.
5. **Učitel vidí osobní kódy Žáků** a mohl by se za Žáka přihlásit. Je to
   přijatelné, pokud se zobrazení kódů zaznamenává?
6. **DPIA.** Screening (oddíl 6 posouzení) vychází tak, že úplné DPIA
   pravděpodobně není povinné; Billanta nabídne předvyplněnou
   zjednodušenou verzi.
7. **Omezení odpovědnosti** v 9.1: rozhodnout, zda vůbec a do jaké výše.
8. **Registr smluv:** bezúplatná smlouva by neměla podléhat uveřejnění;
   ověřit.
9. **Verze v aplikaci.** Formulář žádosti odkazuje na obecnou smlouvu
   o zpracování (`/legal/dpa`) a ukládá verzi `classroom-dpa-0.1`. Po
   schválení textu zveřejnit tuto smlouvu jako samostatnou stránku
   a verzi zvýšit.
