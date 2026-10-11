# Billanta vs. konkurence (CZ/SK)

Stav k 2026-10-03. Ceny jsou měsíční, bez DPH, z veřejných ceníků (zdroje dole).
Interní podklad, ne marketingový text.

## Ceníky

| | Zdarma | Placené tarify | Pozn. |
|---|---|---|---|
| Fakturoid | 5 zákazníků | 82–393 Kč | 30 dní zkušebně, startupy −50 % |
| iDoklad | 5 kontaktů | 187–625 Kč | 60 dní zkušebně, garance vrácení peněz |
| Vyfakturuj | 5 kontaktů | 175–620 Kč | startupy −80 % |
| SuperFaktura | 5 kontaktů | 129–469 Kč | 30 dní zdarma |
| BitFaktura | 1 faktura/měsíc | od 129 Kč | čtení přijatých faktur z fotky |

**Návrh pro Billantu** (rozhodnutí je na ownerovi):

- Zdarma: 5 zákazníků (standard trhu).
- Basic: ~129–149 Kč.
- Pro: ~249–299 Kč, obsahuje AI s naším klíčem a párování plateb.
- K tomu 60denní trial a slevu pro startupy.

## Funkce

✅ máme · 🟡 částečně · ❌ chybí

| Funkce | Billanta | Konkurence | Priorita |
|---|---|---|---|
| Ruční vystavení, číselné řady, PDF | ✅ | všichni | – |
| Našeptávač ARES (název i IČO) | ✅ | všichni | – |
| QR platba (SPAYD) | ✅ | všichni | – |
| ISDOC export | ✅ zdarma | Fakturoid jen v placeném | – |
| Opakované faktury | ✅ | všichni | – |
| Upomínky po splatnosti | ✅ | všichni | – |
| Párování plateb z výpisu (CSV/MT940) | ✅ | většina; přímé napojení na banku je u dražších tarifů | – |
| Náklady / přijaté doklady (ruční zadání) | ✅ | všichni | – |
| Veřejný odkaz na fakturu pro odběratele | ✅ | všichni | – |
| Duplikace faktury, oblíbení zákazníci | ✅ | všichni | – |
| Zálohy (Google Drive, lokální stažení) | ✅ | spíš výjimka | – |
| Veřejné API + API klíče | ✅ | Fakturoid, iDoklad | – |
| **AI předvyplnění z věty / hlasu (Telegram)** | ✅ | nikdo | náš náskok |
| **Vlastní AI klíč firmy** | ✅ | nikdo | náš náskok |
| Přihlášení přes Seznam, Microsoft, Apple | ✅ | spíš ne | náš náskok |
| Čtení přijaté faktury z fotky/PDF (AI) | ❌ | BitFaktura, iDoklad, Fakturoid | **1** |
| Zálohová faktura + daňový doklad k platbě | ❌ | všichni | **1** (v CZ nutnost) |
| Opravný daňový doklad (dobropis) | ❌ | všichni | **1** (zákonná nutnost) |
| Přístup pro účetní (role existuje, chybí pozvánka a UI) | 🟡 | všichni | 2 |
| Export pro účetní (Pohoda XML, CSV, KH/DPH podklady) | ❌ | všichni | 2 |
| Cenové nabídky → převod na fakturu | ❌ | iDoklad, Vyfakturuj, SuperFaktura | 2 |
| Platební brána na faktuře (karta) | ❌ | Fakturoid, SuperFaktura | 3 |
| Přímé napojení banky (Fio API apod.) | ❌ | Fakturoid, iDoklad | 3 |
| Sklad / ceník položek | 🟡 (návrhy z historie) | iDoklad, SuperFaktura | 3 |
| Klientský portál, výkazy času | ❌ | Invoice Ninja | 4 |
| Mobilní aplikace | 🟡 PWA-friendly web | všichni | 4 |

## Co nedělat

- **Porovnávání faktur** nedává smysl. Nikdo z konkurence ho nemá a uživatelé ho nepotřebují.
- **Oblíbené faktury** nahrazuje duplikace a hvězdička u zákazníka.
- **Invoice Ninja** má Elastic License, takže z něj bereme jen inspiraci, žádný kód.

## Zdroje

- https://www.fakturoid.cz/cenik
- https://www.idoklad.cz/cenik
- https://www.vyfakturuj.cz/cenik/
- https://www.superfaktura.cz/cenik/
- https://bitfaktura.cz/cenik
- https://github.com/invoiceninja/invoiceninja
