#!/usr/bin/env node
// Builds apps/frontend/data/cz-offices.json: PSČ (+ obec name where one PSČ
// spans several offices) -> [kód FÚ, kód územního pracoviště, kód OSSZ].
// It only prefills the yearly filing form, so every ambiguous case is left
// as 0 (the user picks) rather than guessed.
//
// Inputs (download them yourself, then pass the paths):
//   1. Česká pošta "Seznam obcí a částí obcí s PSČ" (zv_cobce_psc.csv, cp1250)
//      https://www.ceskaposta.cz/documents/d/guest/csv_cobce_psc-zip?download=true
//      PSČ alone is not enough (138 PSČ span more than one okres), so it
//      gives the obec / městská část code and name for each PSČ.
//   2. Finanční správa číselník "obce" (ADIS, pipe separated)
//      https://mojedane.gov.cz/mepo/pub/api/ciselniky/soubor/obce
//      obec (or městská část of a statutory city) -> c_fu (= c_pufo).
//   3. Finanční správa číselník "pracufo"
//      https://mojedane.gov.cz/mepo/pub/api/ciselniky/soubor/pracufo
//      c_pufo -> c_pracufo (DPFDP7 <c_pracufo>) and c_ufo (<c_ufo_cil>).
//   4. ČSSZ číselník C_COKR exported to TSV (first two columns: kód, název)
//      https://www.cssz.gov.cz/web/cz/ciselniky
//      okres name -> kód OSSZ (<prehledosvc dep>). Prague (PSSZ 110-123) is
//      not split by okres and is left to the user.
//
// usage: node scripts/build-cz-offices.mjs <zv_cobce_psc.csv> <obce> <pracufo> <cokr.tsv> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';

const [cpFile, obceFile, pracFile, cokrFile, outFile] = process.argv.slice(2);
if (!outFile) {
  console.error('usage: build-cz-offices.mjs <zv_cobce_psc.csv> <obce> <pracufo> <cokr.tsv> <out.json>');
  process.exit(1);
}

const norm = (s) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

const pipeRows = (file) =>
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((l) => l.split('|'));

// pracufo: only offices still in existence.
const byPufo = new Map(); // c_pufo -> [{ufo, prac}]
for (const r of pipeRows(pracFile)) {
  const [prac, , , ufo, , zanik, pufo] = r;
  if (zanik) continue;
  const list = byPufo.get(pufo) ?? [];
  list.push({ ufo: Number(ufo), prac: Number(prac) });
  byPufo.set(pufo, list);
}

// obce: rows without an end date are the current assignment.
const fuByObec = new Map();
for (const r of pipeRows(obceFile)) {
  const [obec, , , fu, , konec] = r;
  if (konec) continue;
  fuByObec.set(obec, fu);
}

// OSSZ by okres name. Names differ slightly between ČSSZ and Česká pošta.
const OKRES_ALIAS = { brno: 'brno-mesto', ostrava: 'ostrava-mesto' };
const osszByOkres = new Map();
for (const line of readFileSync(cokrFile, 'utf8').split(/\r?\n/)) {
  const [code, name] = line.split('\t');
  if (!/^\d{3}$/.test(code ?? '') || Number(code) < 200) continue;
  const key = norm(name);
  osszByOkres.set(OKRES_ALIAS[key] ?? key, Number(code));
}

const cp = new TextDecoder('windows-1250').decode(readFileSync(cpFile)).split(/\r?\n/);
const head = cp[0].split(';');
const col = (n) => head.indexOf(n);
const C = Object.fromEntries(
  ['nazcobce', 'psc', 'kodobce', 'nazobce', 'kodokresu', 'nazokresu', 'kodmomc', 'nazmomc'].map((n) => [n, col(n)])
);

const misses = { fu: new Set(), okres: new Set() };
const perPsc = new Map(); // psc -> Map(nameKey -> Set(result))
for (const line of cp.slice(1)) {
  if (!line) continue;
  const f = line.split(';');
  const psc = f[C.psc];
  const obec = f[C.kodmomc] || f[C.kodobce];
  const fu = fuByObec.get(obec);
  const offices = fu ? byPufo.get(fu) : undefined;
  if (!offices) misses.fu.add(`${f[C.nazobce]} ${obec}`);
  const ufos = new Set((offices ?? []).map((o) => o.ufo));
  const ufo = ufos.size === 1 ? [...ufos][0] : 0;
  // c_pufo 57 belongs to two pracoviště (Praha-východ and Brandýs); no way to tell.
  const prac = offices?.length === 1 ? offices[0].prac : 0;
  const prague = f[C.kodokresu] === '3100';
  const ossz = prague ? 0 : osszByOkres.get(norm(f[C.nazokresu])) ?? 0;
  if (!prague && !ossz) misses.okres.add(f[C.nazokresu]);
  const result = `${ufo},${prac},${ossz}`;
  const names = perPsc.get(psc) ?? new Map();
  // An address names the obec, or in a statutory city often the městská
  // část or its quarter ("Brno-Židenice", "Vršovice"). Village parts
  // elsewhere would triple the file for little gain.
  const candidates = [f[C.nazobce], f[C.nazmomc], f[C.kodmomc] ? f[C.nazcobce] : ''];
  for (const n of candidates) {
    if (!n) continue;
    const set = names.get(norm(n)) ?? new Set();
    set.add(result);
    names.set(norm(n), set);
  }
  perPsc.set(psc, names);
}

// Several candidates: keep what they agree on, zero the rest.
const merge = (results) => {
  const parts = [...results].map((r) => r.split(','));
  return [0, 1, 2].map((i) => (new Set(parts.map((p) => p[i])).size === 1 ? parts[0][i] : '0')).join(',');
};

// Each distinct result is stored once in `offices`; PSČ entries hold its index.
const offices = [];
const ref = (r) => {
  let i = offices.indexOf(r);
  if (i < 0) i = offices.push(r) - 1;
  return i;
};
const out = {};
let split = 0;
for (const [psc, names] of [...perPsc].sort(([a], [b]) => a.localeCompare(b))) {
  const all = new Set([...names.values()].flatMap((s) => [...s]));
  if (all.size === 1) {
    out[psc] = ref([...all][0]);
    continue;
  }
  split++;
  // '*' is what every obec under this PSČ agrees on, for a name we do not know.
  const fallback = merge(all);
  const byName = { '*': ref(fallback) };
  for (const [n, set] of [...names].sort(([a], [b]) => a.localeCompare(b))) {
    const r = merge(set);
    if (r !== fallback) byName[n] = ref(r);
  }
  out[psc] = byName;
}

const json = { offices: offices.map((r) => r.split(',').map(Number)), psc: out };
writeFileSync(outFile, JSON.stringify(json) + '\n');
console.log(`${Object.keys(out).length} PSČ, ${split} split by obec name`);
console.log(`obce without an office: ${misses.fu.size}`, [...misses.fu].slice(0, 10));
console.log(`okresy without OSSZ: ${misses.okres.size}`, [...misses.okres]);
