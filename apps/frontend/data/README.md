# `municipalities.json` — data provenance

This file backs the `/invoicing/[slug]` local-SEO landing pages (one per
Czech/Slovak municipality). **Every row is a real, verifiable municipality.**
None of the names, regions, or districts in this file were generated or
guessed by an LLM — see the exact sources and processing steps below so this
can be audited or refreshed later.

## Coverage

- **9,041 municipalities total**: 6,151 in Czechia + 2,890 in Slovakia. (Parts of the statutory cities — Brno, Ostrava, Plzeň, … — and a few split villages came in as separate rows with the same name and district; they are merged into one entry with the averaged position.)
- Czechia's real municipality count is commonly cited as ~6,254 (ČSÚ). This
  file has 6,234 — 107 municipalities (1.7%) from the raw source were
  **dropped rather than guessed** because their district could not be
  reliably resolved (see "Known gaps" below). No municipality's name, region,
  or district was invented to fill the gap.
- Slovakia's real municipality count is 2,890 (Bratislava and Košice counted
  once each, as the single incorporated cities they legally are). This file
  has exactly 2,890.

## Sources

### Czechia

1. **Primary list + region (kraj) per municipality**:
   [`cesko-digital/obce`](https://github.com/cesko-digital/obce), data file
   `https://data.cesko.digital/obce/1/obce.json` (fetched 2026-09-09; dataset
   timestamped `2023-03-26` by its publisher, refreshed weekly from the
   Czech POINT public-bodies registry + RÚIAN). Filtered to records with
   `pravniForma.label === "Obec"` (6,340 rows).
   - Praha is represented in this source only via its 57 city-district rows
     (`Městská část hlavního města Prahy`, e.g. "Praha 1", "Praha-Suchdol"),
     not as one "Obec" row. We synthesized exactly one `Praha` entry from
     those rows (same real `obecKod` 554782, region "Hlavní město Praha",
     district "Praha") rather than either dropping Prague or creating 57
     separate landing pages for its city districts.
2. **District (okres) per municipality**:
   [`rotten77/cr-kraje-okresy-obce`](https://github.com/rotten77/cr-kraje-okresy-obce)
   (fetched 2026-09-09), a MySQL dump of ČSÚ's kraj/okres/obec structure
   (per its README, reflecting the 2008–2012 administrative structure).
   Czech municipality codes (`kod`/`obecKod`) are stable long-term
   identifiers, so this is used purely as a `obecKod -> okres name` lookup
   joined against the current (2023) municipality list above. For the ~2.3%
   of rows lacking an `obecKod` in the primary source, we fell back to an
   exact `(name, kraj)` match against this same dump, but only when that
   match was unambiguous.

### Slovakia

[`m-a-k-o/slovenske-obce`](https://github.com/m-a-k-o/slovenske-obce)
(fetched 2026-09-09), `obce.json` — name, okres (district), kraj (region),
and coordinates for 2,897 places. This is a cleaner, already-deduplicated
municipality list (no postal-code splits), unlike some alternative SK
open-data sources that mix in postal sub-delivery zones.

- The source lists Bratislava and Košice only via their internal statistical
  districts (`Bratislava I`–`V`, `Košice I`–`IV` — 9 rows total). Those are
  **not** independent municipalities, so we replaced them with one verified
  `Bratislava` and one verified `Košice` entry each (same real coordinates,
  region, and — for the city itself — its own district), matching the
  standard citation of 2,890 municipalities in Slovakia.

## Known gaps / what's NOT in this file

- **107 Czech municipalities are missing** (listed in the build script's
  `cz_dropped.json` output, not committed) because the current source
  either had no `obecKod` and no unambiguous name+kraj match in the district
  lookup, or (in one observed case) had corrupted data upstream (a street
  address instead of a municipality name). These were excluded rather than
  guessed. Anyone wanting full coverage should source district data directly
  from ČSÚ's official číselník (e.g. via RÚIAN VDP) and re-run the join.
- **Population** is `null` for 21 rows (19 CZ, 2 SK) whose official row
  could not be matched, mostly the corrupted upstream rows mentioned above.
  None were estimated.
- Coordinates (`lat`/`lon`) are present for most rows (from the same
  sources) but are `null` for Praha, since the source represents Prague only
  via its districts and we did not want to arbitrarily pick one district's
  coordinates to represent the whole city.

## Schema

```ts
{
  slug: string;        // unique, used in /invoicing/[slug]
  name: string;         // official municipality name, with diacritics
  nameAscii: string;    // diacritics stripped (for search/matching)
  region: string;       // kraj (CZ) / kraj (SK) — human-readable name
  district: string;     // okres (CZ) / okres (SK) — human-readable name
  country: 'CZ' | 'SK';
  lat: number | null;
  lon: number | null;
  population: number | null; // see "Population" below
}
```

`slug` is `name` ASCII-folded and hyphenated; when two municipalities share a
name (common — e.g. there are two Czech villages called "Broumov"), the
district name is appended, then the region, then a numeric suffix as a last
resort. All 9,041 slugs are unique by construction — see
`apps/frontend/lib/municipalities.ts`.

## Population

Added 2026-10-18 by `data/add-population.py` (run it with the three files
below; it rewrites `municipalities.json` in place and prints what it could
not match). Used for which town pages are indexed
(`MUNICIPALITY_INDEX_MIN_POPULATION`) and shown on each page.

- **CZ**: ČSÚ, *Počet obyvatel v obcích k 1. 1. 2025*, file
  `1300722503.xlsx` from `13007225_data.zip` on
  https://csu.gov.cz/produkty/pocet-obyvatel-v-obcich-rlm0s92pwn. Joined
  on name + okres. A name that is unique in both files is accepted even
  when the okres differs, because our okres source predates a few boundary
  changes (the Domažlice villages, for example).
- **SK**: ŠÚ SR DATAcube `om7014rr` (*Hustota obyvateľstva – obce*),
  indicator IN010052 *Stav trvale bývajúceho obyvateľstva k 30.6.*, year
  2025, from
  `https://data.statistics.sk/api/v2/dataset/om7014rr/all/2025/all?lang=sk&type=json`.
  The first six characters of each municipality code are its okres; each
  okres code is mapped to our okres name by where its municipality names
  occur, then joined on name + okres. Bratislava and Košice are the sum of
  their city districts.

## Regenerating this file

The fetch + join + dedupe script used to build this file was run ad hoc
during development and is not currently checked into the repo. If this data
needs refreshing, repeat the steps above: fetch the two sources, join CZ
municipalities to their district via `obecKod`, drop unresolvable rows
(don't guess), and slugify with the collision rules described above.

## Derived office data (not stored in this file)

The city pages also name offices derived in code from `region`/`district`,
not from extra columns here:

- **Finanční úřad / Daňový úrad**: `getTaxOffice()` in `lib/municipalities.ts`
  (CZ: one krajský FÚ per kraj; SK: by region seat).
- **OSSZ (CZ only)**: `getSocialSecurityOffice()`, one per okres, checked
  against the ČSSZ contact list by kraj
  (https://www.cssz.gov.cz/web/cz/kontakty) in October 2026. Exceptions:
  Praha (PSSZ), Brno-město (MSSZ Brno), the three Plzeň okresy (OSSZ Plzeň).

Not included yet, because they need a dataset download that has not been
done: the FÚ územní pracoviště and the ORP (živnostenský úřad) per obec.
Both can be built from ČSÚ code list 65 with its obec link
(`apl.czso.cz/iSMS/do_cis_export?kodcis=65&typdat=1&cisvaz=43_1182&format=2`)
or the ČÚZK RÚIAN `vazby-cr.csv` (CC BY 4.0). This file has no obec codes,
so `obecKod` has to be added first for the join. Health insurance is not
tied to a locality, and Slovak Sociálna poisťovňa branches do not map 1:1
to okresy, so neither is shown as an office.
