const fs = require('fs');
const sql = fs.readFileSync('cr-kraje-okresy-obce.sql', 'utf8');

function extractInsert(table) {
  const re = new RegExp("INSERT INTO `" + table + "`[^;]*;", "s");
  const m = sql.match(re);
  if (!m) throw new Error("not found: " + table);
  return m[0];
}

// okres: (id, kraj_id, 'kod', 'nazev')
const okresBlock = extractInsert('okres');
const okresRows = [...okresBlock.matchAll(/\((\d+),\s*(\d+),\s*'([^']*)',\s*'([^']*)'\)/g)];
const okresById = {};
for (const r of okresRows) {
  okresById[r[1]] = { krajId: r[2], kod: r[3], nazev: r[4] };
}
console.log('okres rows:', okresRows.length);

// obec: (id, kraj_id, okres_id, 'kod', 'nazev')
const obecBlock = extractInsert('obec');
const obecRows = [...obecBlock.matchAll(/\((\d+),\s*(\d+),\s*(\d+),\s*'([^']*)',\s*'((?:[^'\]|\.)*)'\)/g)];
console.log('obec rows:', obecRows.length);

const obecKodToOkres = {};
let missing = 0;
for (const r of obecRows) {
  const [, id, krajId, okresId, kod, nazev] = r;
  const okres = okresById[okresId];
  if (!okres) { missing++; continue; }
  obecKodToOkres[kod] = okres.nazev;
}
console.log('missing okres refs:', missing);
console.log('unique obec kod -> okres mappings:', Object.keys(obecKodToOkres).length);
fs.writeFileSync('obecKodToOkres.json', JSON.stringify(obecKodToOkres));
// sample
console.log(Object.entries(obecKodToOkres).slice(0,5));
