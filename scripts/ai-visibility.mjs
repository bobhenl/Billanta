#!/usr/bin/env node
/**
 * AI visibility tracker: asks AI assistants the questions Czech and Slovak
 * freelancers ask when picking an invoicing app, and records whether Billanta
 * comes up and next to which competitors. Meant to run once a month; the
 * results are dated, so runs can be compared over time.
 *
 *   node scripts/ai-visibility.mjs --dry-run          # no API calls, nothing written
 *   node scripts/ai-visibility.mjs                    # every provider with a key set
 *   node scripts/ai-visibility.mjs --only=anthropic,openai --limit=5
 *
 * Keys come from the environment only, never from a file in the repo:
 *   OPENAI_API_KEY, ANTHROPIC_API_KEY, PERPLEXITY_API_KEY, GEMINI_API_KEY
 * Models can be overridden with OPENAI_MODEL, ANTHROPIC_MODEL,
 * PERPLEXITY_MODEL, GEMINI_MODEL. A provider without a key is skipped.
 *
 * Output (default docs/ai-visibility/, override with --out=DIR):
 *   <date>.json   every prompt, provider, answer and the brands found in it
 *   history.csv   one summary row per provider and run, appended
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PROMPTS = [
  // Czech
  { lang: 'cs', text: 'Jaký je nejlepší fakturační program pro OSVČ?' },
  { lang: 'cs', text: 'Doporuč mi online fakturaci zdarma pro živnostníka.' },
  { lang: 'cs', text: 'Jaká fakturační aplikace umí export do ISDOC?' },
  { lang: 'cs', text: 'Potřebuji vystavit fakturu bez registrace. Kde to jde?' },
  { lang: 'cs', text: 'Jaký fakturační software je nejlevnější pro neplátce DPH?' },
  { lang: 'cs', text: 'Fakturoid nebo iDoklad? A existuje lepší alternativa?' },
  { lang: 'cs', text: 'Jaká je dobrá levnější alternativa k Fakturoidu?' },
  { lang: 'cs', text: 'Který fakturační program přidá na fakturu QR platbu a načte firmu z ARES?' },
  { lang: 'cs', text: 'Fakturační aplikace s umělou inteligencí, která vystaví fakturu z hlasové zprávy?' },
  { lang: 'cs', text: 'Jaký program na fakturaci a evidenci výdajů pro malou firmu doporučuješ?' },
  { lang: 'cs', text: 'Jakou fakturační aplikaci používat, když účetnictví mi vede účetní?' },
  { lang: 'cs', text: 'Který fakturační systém umí párovat platby z banky a posílat upomínky?' },
  { lang: 'cs', text: 'Jaký fakturační program umí podat přiznání k DPH a kontrolní hlášení?' },
  { lang: 'cs', text: 'Nejlepší fakturační aplikace na mobil pro freelancery v Česku' },
  { lang: 'cs', text: 'Fakturace pro OSVČ s paušální daní – jaký program?' },
  // Slovak
  { lang: 'sk', text: 'Aký je najlepší fakturačný program pre SZČO?' },
  { lang: 'sk', text: 'Odporuč mi online fakturáciu zadarmo pre živnostníka na Slovensku.' },
  { lang: 'sk', text: 'SuperFaktúra alebo KROS? Existuje lepšia alternatíva?' },
  { lang: 'sk', text: 'Aká je lacnejšia alternatíva k SuperFaktúre?' },
  { lang: 'sk', text: 'Ktorý fakturačný program dáva na faktúru QR kód PAY by square?' },
  { lang: 'sk', text: 'Aký fakturačný softvér je pripravený na povinnú e-fakturáciu od roku 2027?' },
  { lang: 'sk', text: 'Fakturačná aplikácia, ktorá načíta firmu z registra podľa IČO?' },
  { lang: 'sk', text: 'Aký program na faktúry odporúčaš pre malú firmu, platiteľa DPH?' },
  { lang: 'sk', text: 'Fakturačná aplikácia s umelou inteligenciou pre freelancerov na Slovensku' },
  { lang: 'sk', text: 'Kde vystavím faktúru online bez registrácie?' }
];

/**
 * Brand name patterns, matched on the answer with accents stripped. Czech and
 * Slovak inflect names ("ve SuperFaktúře", "do Pohody"), so the stems allow
 * an ending. Pohoda and KROS are also ordinary words, so they must be
 * capitalised; the rest ignore case.
 */
const BRANDS = {
  Billanta: /\bbillant\p{L}{0,3}\b/iu,
  Fakturoid: /\bfakturoid\p{L}{0,3}\b/iu,
  iDoklad: /\bidoklad\p{L}{0,3}\b/iu,
  SuperFaktura: /\bsuperfaktur\p{L}{0,3}\b/iu,
  Vyfakturuj: /\bvyfakturuj\b/iu,
  BitFaktura: /\bbitfaktur\p{L}{0,3}\b/iu,
  KROS: /\bKROS\p{L}{0,3}\b|\bKros\p{L}{0,3}\b/u,
  Billdu: /\bbilldu\b/iu,
  Pohoda: /\bPohod\p{L}{0,3}\b/u,
  'Money S3': /\bmoney\s?s3\b/iu,
  'ABRA Flexi': /\babra\b|\bflexibee\b/iu,
  'Fakturace Online': /\bfakturace[\s-]?online\b/iu
};
const OWN = 'Billanta';

const SYSTEM =
  'Answer the question as you would for a real user in their language. Name specific products where relevant. Keep it under 250 words.';

const PROVIDERS = {
  openai: {
    env: 'OPENAI_API_KEY',
    model: () => process.env.OPENAI_MODEL || 'gpt-5',
    async ask(key, model, prompt) {
      const json = await post('https://api.openai.com/v1/chat/completions', { authorization: `Bearer ${key}` }, {
        model,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: prompt }
        ]
      });
      return json.choices?.[0]?.message?.content ?? '';
    }
  },
  anthropic: {
    env: 'ANTHROPIC_API_KEY',
    model: () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
    async ask(key, model, prompt) {
      const json = await post('https://api.anthropic.com/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, {
        model,
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt }]
      });
      return (json.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    }
  },
  perplexity: {
    env: 'PERPLEXITY_API_KEY',
    model: () => process.env.PERPLEXITY_MODEL || 'sonar',
    async ask(key, model, prompt) {
      const json = await post('https://api.perplexity.ai/chat/completions', { authorization: `Bearer ${key}` }, {
        model,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: prompt }
        ]
      });
      const text = json.choices?.[0]?.message?.content ?? '';
      // Perplexity searches the web; its sources say which pages it read.
      const sources = json.search_results?.map((r) => r.url) ?? json.citations ?? [];
      return sources.length ? `${text}\n\nSources:\n${sources.join('\n')}` : text;
    }
  },
  gemini: {
    env: 'GEMINI_API_KEY',
    model: () => process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    async ask(key, model, prompt) {
      const json = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': key }, {
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      });
      return (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    }
  }
};

async function post(url, headers, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000)
  });
  const text = await res.text();
  // The body never contains the key, so the first bit of it is safe to show.
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

const normalise = (s) => s.normalize('NFD').replace(/\p{M}/gu, '');

/** The brands named in an answer, in the order they first appear. */
export function findBrands(answer) {
  const text = normalise(answer);
  return Object.entries(BRANDS)
    .map(([name, re]) => ({ name, at: text.search(re) }))
    .filter((b) => b.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((b) => b.name);
}

function args() {
  const out = { dryRun: false, only: null, limit: Infinity, out: path.join(ROOT, 'docs', 'ai-visibility') };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--only=')) out.only = a.slice(7).split(',');
    else if (a.startsWith('--limit=')) out.limit = Number(a.slice(8));
    else if (a.startsWith('--out=')) out.out = path.resolve(a.slice(6));
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/ai-visibility.mjs [--dry-run] [--only=openai,anthropic,perplexity,gemini] [--limit=N] [--out=DIR]');
      process.exit(0);
    } else throw new Error(`Unknown argument ${a}`);
  }
  return out;
}

function summarise(results) {
  const byProvider = new Map();
  for (const r of results) {
    const s = byProvider.get(r.provider) ?? { provider: r.provider, model: r.model, asked: 0, answered: 0, mentioned: 0, firstPlace: 0, rivals: {} };
    s.asked++;
    if (!r.error) s.answered++;
    if (r.brands.includes(OWN)) s.mentioned++;
    if (r.brands[0] === OWN) s.firstPlace++;
    for (const b of r.brands) if (b !== OWN) s.rivals[b] = (s.rivals[b] ?? 0) + 1;
    byProvider.set(r.provider, s);
  }
  return [...byProvider.values()];
}

async function main() {
  const opts = args();
  const prompts = PROMPTS.slice(0, opts.limit);
  const providers = Object.entries(PROVIDERS).filter(([name]) => !opts.only || opts.only.includes(name));
  const ready = providers.filter(([, p]) => process.env[p.env]);
  const date = new Date().toISOString().slice(0, 10);

  console.log(`${prompts.length} prompts (${prompts.filter((p) => p.lang === 'cs').length} cs, ${prompts.filter((p) => p.lang === 'sk').length} sk)`);
  for (const [name, p] of providers) console.log(`- ${name}: ${process.env[p.env] ? `key set, model ${p.model()}` : `skipped, ${p.env} not set`}`);

  if (opts.dryRun) {
    // Exercise the matcher on a made-up answer so a broken pattern shows up here.
    const sample = 'Zkuste Fakturoid, iDoklad nebo SuperFaktúru. Billanta má tarif zdarma, v pohodě; účetní pak data načte do Pohody nebo Money S3.';
    const found = findBrands(sample);
    const expected = ['Fakturoid', 'iDoklad', 'SuperFaktura', 'Billanta', 'Pohoda', 'Money S3'];
    if (found.join() !== expected.join()) throw new Error(`Brand matcher self-test failed: ${found.join(', ')}`);
    console.log(`Brand matcher self-test passed: ${found.join(', ')}`);
    console.log(`Dry run: would make ${prompts.length * ready.length} API calls and write ${path.relative(ROOT, path.join(opts.out, `${date}.json`))}. Nothing sent, nothing written.`);
    return;
  }
  if (!ready.length) throw new Error('No provider has an API key in the environment. Set at least one of ' + Object.values(PROVIDERS).map((p) => p.env).join(', '));

  const results = [];
  for (const [name, p] of ready) {
    const model = p.model();
    for (const prompt of prompts) {
      const started = Date.now();
      try {
        const answer = await p.ask(process.env[p.env], model, prompt.text);
        results.push({ provider: name, model, lang: prompt.lang, prompt: prompt.text, brands: findBrands(answer), answer, ms: Date.now() - started });
      } catch (err) {
        results.push({ provider: name, model, lang: prompt.lang, prompt: prompt.text, brands: [], error: String(err.message ?? err), ms: Date.now() - started });
      }
      const last = results.at(-1);
      console.log(`[${name}] ${last.error ? 'ERROR ' + last.error.slice(0, 80) : last.brands.includes(OWN) ? `mentioned (${last.brands.join(', ')})` : `not mentioned (${last.brands.join(', ') || 'no brands'})`} – ${prompt.text}`);
    }
  }

  const summary = summarise(results);
  await mkdir(opts.out, { recursive: true });
  let file = path.join(opts.out, `${date}.json`);
  for (let n = 2; existsSync(file); n++) file = path.join(opts.out, `${date}-${n}.json`);
  await writeFile(file, JSON.stringify({ date, prompts: prompts.length, summary, results }, null, 2) + '\n');

  const csv = path.join(opts.out, 'history.csv');
  const header = 'date,provider,model,asked,answered,mentioned,first_place,top_rivals\n';
  const existing = existsSync(csv) ? await readFile(csv, 'utf8') : '';
  const rows = summary.map((s) => {
    const rivals = Object.entries(s.rivals).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([b, n]) => `${b}:${n}`).join(' ');
    return [date, s.provider, s.model, s.asked, s.answered, s.mentioned, s.firstPlace, `"${rivals}"`].join(',');
  });
  await appendFile(csv, (existing ? '' : header) + rows.join('\n') + '\n');

  console.log('');
  for (const s of summary) console.log(`${s.provider} (${s.model}): Billanta in ${s.mentioned}/${s.answered} answers, first in ${s.firstPlace}`);
  console.log(`Saved ${path.relative(ROOT, file)} and appended ${path.relative(ROOT, csv)}`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
