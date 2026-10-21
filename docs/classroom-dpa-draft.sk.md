# Zmluva o spracúvaní osobných údajov – Billanta pre školy (NÁVRH)

> **Pracovný návrh, nie hotový právny text.** Text pripravil AI asistent,
> nie advokát. Pred zverejnením ho musí prečítať zodpovedná osoba
> niektorej slovenskej školy, najlepšie aj advokát. Verzia návrhu:
> `classroom-dpa-0.2` (2026-10-21). Ide o slovenské znenie českého návrhu
> `docs/classroom-dpa-draft.md`, upravené pre slovenské právo; posúdenie
> je v `docs/classroom-dpo-review.md`.

### Čo treba ešte doplniť alebo overiť

Hranaté zátvorky `[...]` zostali len tam, kde údaj nepoznáme:

| Údaj | Kde | Kto doplní |
|---|---|---|
| obchodné meno / meno, IČO, sídlo a zápis v registri prevádzkovateľa služby | čl. 1 | prevádzkovateľ služby |
| kontaktný e-mail a e-mail pre bezpečnostné incidenty | čl. 1, čl. 7 | prevádzkovateľ služby |
| adresa verejného zoznamu ďalších sprostredkovateľov | čl. 6.1 | prevádzkovateľ služby |
| zmluvný subjekt a lokalita hostingu (OVH Hosting, Inc., Kanada) | čl. 6.4, príloha 2 | prevádzkovateľ služby |
| typ účtu Google pre zálohy (Workspace s Cloud DPA alebo iné úložisko) a región | príloha 2 | prevádzkovateľ služby |
| región odosielania pri službe Resend | príloha 2 | prevádzkovateľ služby |
| či je v produkcii zapnuté šifrovanie záloh | príloha 1 | prevádzkovateľ služby |
| zabezpečenie prístupu k serveru (SSH kľúče, 2FA u poskytovateľa) | príloha 1 | prevádzkovateľ služby |
| obmedzenie zodpovednosti voči Škole | čl. 9.1 | rozhodnutie prevádzkovateľa služby |
| povinnosť zverejniť zmluvu v Centrálnom registri zmlúv | čl. 10.4 | zodpovedná osoba školy |

**Podmienky, bez ktorých túto zmluvu nemožno ponúknuť školám:** prevádzka
cez HTTPS, vyplnená identita prevádzkovateľa služby, potvrdenie zmluvy
štatutárnym orgánom školy (nie iba kliknutím učiteľa) a pravdivo
vyplnená príloha 2.

---

Uzavretá podľa čl. 28 nariadenia Európskeho parlamentu a Rady (EÚ)
2016/679 (ďalej „GDPR“) a zákona č. 18/2018 Z. z. o ochrane osobných
údajov a o zmene a doplnení niektorých zákonov.

## 1. Zmluvné strany

**Prevádzkovateľ:** škola uvedená v žiadosti o školský režim (názov, IČO
a sídlo podľa siete škôl a školských zariadení), ktorú zastupuje riaditeľ
alebo riaditeľka, prípadne osoba, ktorú na to škola písomne poverila
(ďalej „Škola“).

**Sprostredkovateľ:** [obchodné meno / meno prevádzkovateľa služby], IČO
[...], so sídlom [...], zapísaný v [register], kontaktný e-mail [...],
prevádzkovateľ služby Billanta (ďalej „Billanta“).

1.1 Za Školu zmluvu potvrdzuje jej **štatutárny orgán** (riaditeľ) alebo
osoba, ktorú riaditeľ písomne poveril. Potvrdenie prebieha elektronicky:
Billanta pošle odkaz na oficiálny e-mail Školy, riaditeľ si zmluvu prečíta
a potvrdí ju. Škola môže namiesto toho poslať podpísané PDF, dokument
s elektronickým podpisom alebo správu z elektronickej schránky
(slovensko.sk).

1.2 Učitelia Školy potom v Billante zakladajú a vedú triedy **v rámci
poverenia Školy**. Učiteľ v žiadosti vyhlasuje, že na Škole vyučuje. Sám
zmluvu neuzatvára ani nemení.

1.3 Škola v žiadosti uvedie kontaktný e-mail Školy a e-mail svojej
zodpovednej osoby. Na tieto adresy Billanta posiela oznámenia podľa tejto
zmluvy.

## 2. Predmet, povaha a účel spracúvania

2.1 Billanta poskytuje Škole službu „školský režim“: vzdelávacie
prostredie, v ktorom žiaci (ďalej „Žiaci“) vystavujú cvičné doklady
v cvičných firmách s fiktívnymi údajmi a učitelia sledujú ich pokrok.

2.2 Povaha spracúvania: uchovávanie, zobrazovanie, úprava a vymazanie
údajov, ktoré Žiaci a učitelia zadajú do aplikácie; zobrazenie pokroku
triedy učiteľom; zálohovanie; vymazanie po skončení triedy.

2.3 Osobné údaje sa spracúvajú **iba na účel vyučovania** v predmetoch,
ktoré určí Škola, a iba počas doby podľa článku 4. Billanta ich nepoužije
na marketing, profilovanie, predaj, trénovanie modelov umelej inteligencie
ani na iné vlastné účely (čl. 28 ods. 10 GDPR). Štatistiky používania
služby smie vytvárať iba z anonymných súhrnných údajov.

## 3. Kategórie dotknutých osôb a osobných údajov

| Dotknutá osoba | Údaje | Čoho sa netýka |
|---|---|---|
| Žiaci | prezývka (2 až 30 znakov; Škola Žiakov poučí, že nemá obsahovať celé meno); obsah cvičnej firmy (doklady, kontakty, náklady, výkazy času a ďalšie záznamy, ktoré Žiak zadá); osobný kód na opätovné prihlásenie (uložený ako odtlačok HMAC a zašifrovaný); technické údaje (dátum vytvorenia, posledná aktivita, prihlasovacie relácie, počet neúspešných pokusov o prihlásenie na úrovni triedy) | Billanta od Žiakov nežiada e-mail, telefón, heslo, dátum narodenia, fotografiu ani adresu. IP adresa sa neukladá: na ochranu pred zneužitím slúži iba v operačnej pamäti najviac približne 10 minút. |
| Učitelia Školy | meno, e-mail, škola, predmet, nastavenia tried, záznamy o krokoch v triede | Vlastný učiteľský účet (prihlásenie, predplatné) spracúva Billanta ako prevádzkovateľ podľa svojich zásad ochrany osobných údajov. |
| Tretie osoby v cvičných firmách | údaje, ktoré Žiak do firmy zadá alebo načíta z verejného registra (ORSR, RPO, ARES a podobné registre); pri fyzických osobách – podnikateľoch ide o ich meno a adresu | Cvičné firmy sú fiktívne; pozri 3.1. |

3.1 Škola zabezpečí, aby Žiaci do cvičných firiem nezadávali skutočné
osobné údaje tretích osôb mimo verejných registrov ani osobitné kategórie
údajov (čl. 9 a 10 GDPR). Odporúčame pracovať s fiktívnymi údajmi alebo
s právnickými osobami.

## 4. Doba spracúvania a vymazanie

4.1 Údaje Žiakov sa spracúvajú počas trvania triedy. Trieda štandardne
končí 31. augusta a koniec možno nastaviť najviac 13 mesiacov dopredu.
Učiteľ môže triedu predĺžiť, vždy najviac o 13 mesiacov odo dňa
predĺženia. Učiteľ dostane upozornenie 30 a 7 dní pred koncom triedy.

4.2 Po skončení triedy sú cvičné firmy 30 dní iba na čítanie a potom sa
automaticky vymažú. Odstránenie Žiaka učiteľom jeho firmu a údaje vymaže
okamžite. Vymazanie triedy alebo zrušenie účtu učiteľa, ktorý triedu
vlastní, vymaže všetky firmy triedy okamžite.

4.3 Pred vymazaním si môže učiteľ stiahnuť prehľad pokroku triedy
a doklady cvičných firiem. Tým je splnená povinnosť údaje vrátiť (čl. 28
ods. 3 písm. g) GDPR); inak Billanta údaje nevracia.

4.4 Vymazané údaje zostávajú v šifrovaných zálohách najdlhšie **60 dní**
(miestne kópie na serveri 14 dní). Zo záloh sa do prevádzky neobnovujú,
okrem obnovy celej služby po havárii; v takom prípade Billanta znova
vykoná vymazania, o ktorých vie.

## 5. Povinnosti Billanty

5.1 Billanta:

a) spracúva osobné údaje iba na základe zdokumentovaných pokynov Školy,
   a to aj pokiaľ ide o prenos do tretích krajín. Pokynmi sú táto zmluva
   a nastavenia triedy, ktoré učitelia Školy vykonajú v aplikácii. Prenos
   mimo EÚ/EHP je povolený iba podľa článku 6.4. Ak Billante spracúvanie
   ukladá právo EÚ alebo členského štátu, informuje o tom Školu vopred,
   ak to toto právo nezakazuje;

b) zabezpečí, aby sa osoby oprávnené spracúvať osobné údaje zaviazali
   k mlčanlivosti alebo aby ich mlčanlivosť vyplývala zo zákona, a aby mali
   prístup iba v rozsahu nevyhnutnom na prevádzku a podporu služby;

c) prijme technické a organizačné opatrenia podľa čl. 32 GDPR opísané
   v prílohe 1 a bude ich udržiavať na úrovni zodpovedajúcej stavu
   techniky. Opatrenia smie meniť iba tak, aby sa úroveň ochrany neznížila;

d) zapojí ďalších sprostredkovateľov iba podľa článku 6;

e) s ohľadom na povahu spracúvania pomôže Škole plniť povinnosť reagovať
   na žiadosti dotknutých osôb (čl. 15 až 22 GDPR). Väčšinu žiadostí môže
   učiteľ vybaviť priamo v aplikácii (zobrazenie a export firmy, opravy
   záznamov, odstránenie Žiaka). Ostatné Billanta vybaví podľa pokynu
   Školy do 10 pracovných dní. Žiadosť, ktorú dostane priamo od Žiaka
   alebo zákonného zástupcu, postúpi Škole bez zbytočného odkladu a sama
   na ňu vecne neodpovie;

f) pomôže Škole plniť povinnosti podľa čl. 32 až 36 GDPR (bezpečnosť,
   oznamovanie porušenia ochrany osobných údajov, posúdenie vplyvu,
   predchádzajúca konzultácia), s ohľadom na povahu spracúvania
   a informácie, ktoré má k dispozícii. Na požiadanie poskytne podklady
   na posúdenie vplyvu;

g) po skončení spracúvania údaje vymaže podľa článku 4, ak právo EÚ alebo
   členského štátu nevyžaduje ich uchovanie;

h) poskytne Škole informácie potrebné na preukázanie splnenia povinností
   podľa čl. 28 GDPR a umožní audit alebo kontrolu, ktorú vykoná Škola
   alebo audítor poverený Školou a viazaný mlčanlivosťou. Prednostne
   písomnými odpoveďami a dokumentáciou; kontrolu na mieste po
   predchádzajúcej dohode v primeranom termíne, najviac raz ročne, ak
   nejde o kontrolu po porušení ochrany osobných údajov alebo na pokyn
   dozorného orgánu;

i) Školu bezodkladne upozorní, ak sa podľa jej názoru pokynom porušuje
   GDPR, zákon č. 18/2018 Z. z. alebo iné predpisy o ochrane osobných
   údajov, a na každú žiadosť orgánu verejnej moci o prístup k údajom
   Žiakov, ak to právo nezakazuje;

j) vedie záznamy o spracovateľských činnostiach podľa čl. 30 ods. 2 GDPR
   a na požiadanie ich sprístupní Škole alebo Úradu na ochranu osobných
   údajov Slovenskej republiky.

5.2 Billanta nesmie údaje Žiakov sprístupniť iným používateľom služby
okrem učiteľov danej triedy, ktorých určila Škola.

## 6. Ďalší sprostredkovatelia a prenos mimo EÚ

6.1 Škola udeľuje všeobecné povolenie na zapojenie ďalších
sprostredkovateľov uvedených v prílohe 2. Aktuálny zoznam je aj na
[URL zoznamu sprostredkovateľov].

6.2 O zamýšľanom pridaní alebo nahradení ďalšieho sprostredkovateľa
Billanta informuje Školu e-mailom na kontakty podľa 1.3 najmenej **30 dní
vopred**. Škola môže do konca tejto lehoty vzniesť odôvodnenú námietku. Ak
sa strany nedohodnú, môže Škola zmluvu bez sankcie ukončiť ku dňu zmeny;
Billanta potom triedy Školy ukončí a údaje vymaže podľa článku 4.

6.3 Billanta uloží každému ďalšiemu sprostredkovateľovi zmluvou rovnaké
povinnosti ochrany údajov, aké má podľa tejto zmluvy, najmä záruky podľa
5.1 c). Za plnenie jeho povinností zodpovedá Škole, ako keby išlo o jej
vlastné.

6.4 Údaje Žiakov sa spracúvajú v EÚ/EHP alebo v krajine, o ktorej
Európska komisia rozhodla, že zaručuje primeranú úroveň ochrany (čl. 45
GDPR). Prenos inam je prípustný iba so zárukami podľa kapitoly V GDPR
(štandardné zmluvné doložky alebo certifikácia podľa rámca ochrany údajov
medzi EÚ a USA) a pri zálohách iba v podobe zašifrovanej tak, že príjemca
nemá kľúč. Kde sa údaje fyzicky nachádzajú, uvádza príloha 2.

## 7. Porušenie ochrany osobných údajov

7.1 Billanta oznámi Škole porušenie ochrany osobných údajov, ktoré sa
týka údajov Žiakov alebo učiteľov Školy, **bez zbytočného odkladu,
najneskôr do 48 hodín od chvíle, keď sa o ňom dozvedela**. Oznámenie
pošle e-mailom na kontakty podľa 1.3 a učiteľovi, ktorý triedu vlastní;
kópiu možno poslať do elektronickej schránky Školy.

7.2 Oznámenie obsahuje informácie podľa čl. 33 ods. 3 GDPR, ktoré sú
v tom čase známe (povaha porušenia, kategórie a približný počet Žiakov
a záznamov, pravdepodobné následky, prijaté a navrhované opatrenia,
kontakt). Ďalšie informácie Billanta dopĺňa priebežne, hneď ako ich zistí.

7.3 Billanta bezodkladne prijme opatrenia na zmiernenie následkov
a poskytne Škole súčinnosť pri oznámení Úradu na ochranu osobných údajov
Slovenskej republiky a pri oznámení Žiakom a zákonným zástupcom. Sama za
Školu dozornému orgánu ani dotknutým osobám nič neoznamuje, ak ju o to
Škola nepožiada.

7.4 Kontakt pre bezpečnostné incidenty: [e-mail pre incidenty].

## 8. Povinnosti a práva Školy

Škola:

a) zodpovedá za to, že spracúvanie má právny základ. Pri verejných
   školách ide spravidla o plnenie úlohy vo verejnom záujme podľa čl. 6
   ods. 1 písm. e) GDPR v spojení so zákonom č. 245/2008 Z. z. (školský
   zákon) a školským vzdelávacím programom. Súhlas Žiakov ani zákonných
   zástupcov sa nevyžaduje;

b) informuje Žiakov a pri neplnoletých aj ich zákonných zástupcov podľa
   čl. 13 GDPR; môže použiť vzor v prílohe 3;

c) poučí Žiakov, aby ako prezývku nepoužívali celé meno a do cvičných
   firiem nezadávali skutočné osobné údaje (pozri 3.1);

d) určí, ktorí učitelia smú zakladať triedy, a oznámi Billante, keď
   niektorý učiteľ prestane byť oprávnený (napr. odíde zo Školy);

e) zabezpečí, aby učitelia chránili osobné kódy Žiakov, ktoré vidia,
   a nepoužívali ich na prihlásenie za Žiaka;

f) má právo kedykoľvek dávať Billante pokyny na spracúvanie, ukončiť
   triedu a požadovať vymazanie údajov.

## 9. Zodpovednosť, trvanie a skončenie

9.1 Zodpovednosť voči dotknutým osobám sa riadi čl. 82 GDPR a nemožno ju
zmluvne obmedziť. [Obmedzenie zodpovednosti Billanty voči Škole, napr.
do výšky X eur, okrem úmyslu a hrubej nedbanlivosti: na rozhodnutie.]

9.2 Zmluva sa uzatvára na dobu neurčitú a trvá, kým má Škola v Billante
triedu, vrátane doby podľa článku 4.

9.3 Ktorákoľvek strana ju môže vypovedať e-mailom s účinnosťou ku koncu
kalendárneho mesiaca, v ktorom bola výpoveď doručená. Účinnosťou výpovede
sa triedy Školy ukončia a údaje sa vymažú podľa článku 4; povinnosti
podľa článkov 4, 5.1 b), 7 a 9.1 trvajú až do úplného vymazania vrátane
záloh.

9.4 Služba je pre školy bezplatná. Obchodné podmienky Billanty sa
použijú, iba ak táto zmluva neustanovuje inak; v otázkach ochrany osobných
údajov má vždy prednosť táto zmluva.

## 10. Záverečné ustanovenia

10.1 Zmluva sa uzatvára v elektronickej podobe (čl. 28 ods. 9 GDPR).
Billanta uchováva záznam o jej potvrdení (verzia textu, dátum a čas, meno
a funkcia osoby, ktorá ju za Školu potvrdila, a e-mail, z ktorého tak
urobila) a na požiadanie pošle Škole PDF.

10.2 Novú verziu zmluvy Billanta pošle Škole najmenej 30 dní pred jej
účinnosťou; ak Škola nesúhlasí, môže zmluvu vypovedať podľa 9.3. Zmeny,
ktoré ochranu údajov iba zlepšujú, môžu platiť skôr.

10.3 Zmluva sa riadi právom Slovenskej republiky.

10.4 [Na overenie so zodpovednou osobou: či ide o povinne zverejňovanú
zmluvu podľa § 5a zákona č. 211/2000 Z. z. o slobodnom prístupe
k informáciám. Zmluva je bezplatná a nenakladá sa ňou s verejnými
prostriedkami ani majetkom, preto pravdepodobne nie; ak áno, nadobúda
účinnosť dňom nasledujúcim po zverejnení v Centrálnom registri zmlúv.]

---

## Príloha 1 – technické a organizačné opatrenia

Opis zodpovedá stavu kódu k 2026-10-21. Položky označené **[podmienka]**
musia platiť skôr, než sa služba ponúkne školám.

**Oddelenie a riadenie prístupu**

- Údaje každej cvičnej firmy sú oddelené na úrovni databázy (row-level
  security v PostgreSQL). Aplikácia sa k databáze pripája rolou, ktorá
  toto oddelenie nemôže obísť. Operácie naprieč firmami (vstup do triedy,
  odstránenie Žiaka, vymazanie triedy) bežia iba cez úzko vymedzené
  databázové funkcie.
- Učitelia triedy majú do firiem Žiakov prístup **iba na čítanie**. Ostatní
  používatelia služby nemajú prístup žiadny.
- Nastavenie cvičných firiem (moduly, zaradenie do triedy) nemožno
  z aplikácie zmeniť; počet záznamov vo firme je obmedzený.
- Cvičné firmy nemôžu odoslať e-mail, platbu ani verejný odkaz, nemajú
  napojenie na banku, API, webhooky ani funkcie AI a nemožno ich previesť
  na skutočný účet.
- Pracovníci prevádzkovateľa služby pristupujú k produkčnému serveru iba
  kvôli prevádzke a podpore. [Doplniť: prístup iba cez SSH kľúče,
  dvojfaktorové overenie u poskytovateľa hostingu, okruh osôb
  s prístupom.]

**Prihlasovanie**

- Žiaci nemajú heslo ani e-mail. Do triedy vstupujú kódom triedy
  a prezývkou; na návrat dostanú osobný kód (8 znakov). Ten je uložený ako
  odtlačok HMAC-SHA256 a osobitne zašifrovaný AES-256-GCM, aby ho učiteľ
  mohol Žiakovi znova ukázať. Učiteľ môže kód vygenerovať nanovo; tým sa
  ukončia všetky prihlásenia Žiaka.
- Po 10 chybných kódoch v triede sa návrat do triedy na 15 minút
  zablokuje. Počet pokusov z jednej IP adresy je obmedzený; IP adresa sa na
  to používa iba v operačnej pamäti a neukladá sa.
- Prihlásenie Žiaka platí najviac 14 dní a nikdy dlhšie ako do vymazania
  firmy.
- Heslá učiteľov sú uložené iba ako odtlačok (bcrypt); učiteľ sa môže
  prihlasovať cez Google. Dvojfaktorové overenie je pre učiteľov dostupné.

**Šifrovanie a prevádzka**

- **[podmienka]** Celá prevádzka cez HTTPS (TLS). K 2026-10-21 beží
  produkcia na adrese bez TLS; školám sa služba neponúkne, kým to neplatí.
- Osobné kódy Žiakov sú uložené zašifrované; tajné kľúče aplikácie sú
  mimo databázy.
- Zálohy databázy sa vytvárajú denne a pred odoslaním mimo server sa
  šifrujú nástrojom `age` verejným kľúčom; súkromný kľúč drží
  prevádzkovateľ služby offline a mimo servera. **[podmienka]** [Overiť, že
  je šifrovanie záloh v produkcii zapnuté.] Kópie na serveri sa uchovávajú
  14 dní, mimo servera 60 dní.
- Logy kontajnerov sa rotujú podľa veľkosti (najviac 3 × 10 MB na službu);
  webový server pre Billantu nevedie prístupový log.
- Vyrovnávacia pamäť (Redis) neukladá údaje na disk.

**Minimalizácia a vymazanie**

- Od Žiakov sa nezískava nič okrem prezývky a toho, čo zadajú do cvičnej
  firmy.
- Na stránkach vstupu do triedy a v aplikácii nie sú analytické ani
  reklamné nástroje. Analytika (Microsoft Clarity) je iba na marketingových
  stránkach a iba so súhlasom.
- Vymazanie po skončení triedy prebieha automaticky (kontrola každých 15
  minút). Učiteľ dostane upozornenie 30 a 7 dní pred koncom triedy.
- Odstránenie Žiaka alebo vymazanie triedy maže údaje okamžite.

**Organizácia**

- Školy schvaľuje pracovník prevádzkovateľa služby ručne; pri schvaľovaní
  nevidí prezývky Žiakov.
- Zmluvy s ďalšími sprostredkovateľmi obsahujú povinnosti podľa čl. 28
  GDPR.
- Postup pri porušení ochrany osobných údajov: zistenie, obmedzenie
  dosahu, oznámenie Škole do 48 hodín (článok 7), záznam o incidente.

## Príloha 2 – ďalší sprostredkovatelia

| Sprostredkovateľ | Účel | Umiestnenie údajov | Týka sa Žiakov? | Právny nástroj prenosu |
|---|---|---|---|---|
| [zmluvný subjekt OVH, overiť] | virtuálny server: aplikácia, databáza, miestne zálohy | Kanada (OVH Hosting, Inc.) | áno | Kanada: rozhodnutie Komisie o primeranosti 2002/2/ES |
| Google (Google Workspace, [overiť edíciu a región]) | uchovávanie šifrovaných záloh databázy | [EÚ, ak je nastavený dátový región; inak celosvetovo vrátane USA] | áno, iba zašifrované bez kľúča | Cloud Data Processing Addendum; rámec ochrany údajov medzi EÚ a USA, náhradne štandardné zmluvné doložky |
| Resend | e-maily učiteľom (schválenie školy, upozornenie na koniec triedy) | [región odosielania, overiť] | nie, Žiaci nemajú e-mail | DPA Resend; rámec ochrany údajov medzi EÚ a USA alebo štandardné zmluvné doložky [overiť] |
| Google (prihlásenie cez Google) | prihlásenie učiteľa, ak ho zvolí | celosvetovo | nie | ako vyššie |

Plánovaný, zatiaľ nezapojený: **Cloudflare** (CDN a ukončenie TLS; uvidí
prevádzku vrátane údajov Žiakov). Pred zapojením bude Škola informovaná
podľa článku 6.2.

V školskom režime sa nepoužívajú poskytovatelia AI, platobné brány,
četovacie aplikácie ani analytika.

## Príloha 3 – vzor informácie pre Žiakov a zákonných zástupcov

Škola môže text upraviť a zverejniť (napr. v školskom systéme alebo na
webe).

> **Cvičné firmy v Billante**
>
> Na hodinách [predmet] používame aplikáciu Billanta. Každý žiak v nej má
> cvičnú firmu s vymyslenými údajmi a učí sa vystavovať faktúry a viesť
> doklady.
>
> **Kto za údaje zodpovedá:** [názov školy], [adresa], kontakt [e-mail
> školy]; zodpovedná osoba: [meno, e-mail]. Aplikáciu prevádzkuje
> [prevádzkovateľ služby] ako náš sprostredkovateľ na základe zmluvy.
>
> **Čo sa o žiakovi ukladá:** iba prezývka, ktorú si žiak zvolí (nemá to
> byť celé meno), a to, čo zadá do svojej cvičnej firmy. Nechceme e-mail,
> telefón ani heslo. Učiteľ vidí cvičné firmy žiakov a ich pokrok.
>
> **Prečo:** ide o súčasť vyučovania podľa školského vzdelávacieho
> programu (čl. 6 ods. 1 písm. e) GDPR, školský zákon). Súhlas preto
> nepotrebujeme.
>
> **Ako dlho:** počas trvania triedy, zvyčajne do konca školského roka
> (učiteľ ju môže predĺžiť). Potom sú firmy 30 dní iba na čítanie
> a vymažú sa. Zo záloh zmiznú najneskôr do 60 dní.
>
> **Kde:** na serveri v [krajina]; zálohy sú šifrované.
>
> **Vaše práva:** môžete požiadať o prístup k údajom, ich opravu alebo
> vymazanie a namietať. Obráťte sa na učiteľa alebo na zodpovednú osobu
> školy. Návrh na začatie konania môžete podať Úradu na ochranu osobných
> údajov Slovenskej republiky (dataprotection.gov.sk).
>
> **Prosíme:** do cvičnej firmy nezadávajte skutočné osobné údaje svoje
> ani iných ľudí.

---

## Na posúdenie (pre zodpovednú osobu školy)

Úplné posúdenie je v `docs/classroom-dpo-review.md`. Otvorené body:

1. **Potvrdenie zmluvy riaditeľom.** Návrh počíta s potvrdením kliknutím
   z oficiálneho e-mailu Školy (článok 1.1). Stačí to, alebo treba
   podpísané PDF či elektronickú schránku? Aplikácia zatiaľ ukladá súhlas
   pri učiteľovi a nezískava kontakt na Školu ani na zodpovednú osobu.
2. **Právny základ.** Čl. 6 ods. 1 písm. e) GDPR a školský zákon bez
   súhlasu zákonných zástupcov; čl. 8 GDPR (a vek 16 rokov podľa § 15
   zákona č. 18/2018 Z. z.) sa neuplatní, lebo nejde o súhlas ani o službu
   ponúkanú priamo dieťaťu.
3. **Hosting mimo EÚ.** Server je v Kanade a zostane tam (rozhodnutie
   o primeranosti, čl. 45 GDPR). Stačí to, alebo budú školy chcieť EÚ?
4. **Zálohy v službe Google.** Iba Google Workspace so zmluvou
   o spracúvaní, ideálne s dátovým regiónom EÚ, alebo úložisko v EÚ.
   Súkromný účet Google neprichádza do úvahy.
5. **Učiteľ vidí osobné kódy Žiakov** a mohol by sa za Žiaka prihlásiť. Je
   to prijateľné, ak sa zobrazenie kódov zaznamenáva?
6. **Posúdenie vplyvu.** Skríning vychádza tak, že úplné posúdenie vplyvu
   pravdepodobne nie je povinné; Billanta ponúkne predvyplnenú
   zjednodušenú verziu.
7. **Centrálny register zmlúv** (článok 10.4).
8. **Obmedzenie zodpovednosti** v 9.1.
