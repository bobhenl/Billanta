import { fuzzyScore } from '@/lib/fuzzy';

/**
 * "AI hledání" in the Ctrl+K palette: turns a plain-language question
 * ("nezaplacené faktury Alza za září", "po splatnosti nad 10 000",
 * "paid invoices last month in EUR") into the invoice list's own filters.
 * Runs locally, instantly and offline: a keyword grammar for cs/sk/en, plus
 * a fuzzy match of the remaining words against the company's customers.
 */
export interface NlInvoiceQuery {
  status?: 'draft' | 'issued' | 'overdue' | 'paid' | 'cancelled';
  type?: 'invoice' | 'proforma' | 'credit_note' | 'quote';
  currency?: string;
  date_field?: 'issue' | 'due' | 'paid';
  from?: string;
  to?: string;
  /** Customer name (or the leftover text) for the list's search box. */
  q?: string;
  /** Matched customer, when the text named one. */
  contactName?: string;
  /** Pieces understood, for the chips under the suggestion. */
  understood: { kind: 'status' | 'type' | 'currency' | 'period' | 'customer' | 'text'; value: string }[];
}

const strip = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const STATUS_WORDS: [RegExp, NonNullable<NlInvoiceQuery['status']>][] = [
  [/\b(po splatnosti|overdue|neuhrazen\w* po|po termin\w*|nesplacen\w* po)\b/, 'overdue'],
  [/\b(nezaplacen\w*|neuhrazen\w*|nezaplaten\w*|otevren\w*|unpaid|open|vystaven\w*|issued|ceka\w* na platbu)\b/, 'issued'],
  [/\b(zaplacen\w*|uhrazen\w*|zaplaten\w*|paid|settled)\b/, 'paid'],
  [/\b(koncept\w*|rozpracovan\w*|draft\w*|navrh\w*)\b/, 'draft'],
  [/\b(storn\w*|zrusen\w*|cancel\w*)\b/, 'cancelled']
];

const TYPE_WORDS: [RegExp, NonNullable<NlInvoiceQuery['type']>][] = [
  [/\b(zaloh\w*|proform\w*|advance)\b/, 'proforma'],
  [/\b(dobropis\w*|credit note\w*|credit)\b/, 'credit_note'],
  [/\b(nabid\w*|ponuk\w*|quote\w*|offer\w*)\b/, 'quote']
];

const CURRENCY_WORDS: [RegExp, string][] = [
  [/\b(eur\w*|€)\b|€/, 'EUR'],
  [/\b(usd|dolar\w*|dollar\w*)\b|\$/, 'USD'],
  [/\b(gbp|liber\w*|pound\w*)\b|£/, 'GBP'],
  [/\b(pln|zlot\w*)\b/, 'PLN'],
  [/\b(czk|kc|korun\w*)\b/, 'CZK']
];

// Month stems: cs (leden…), sk (januar…), en.
const MONTHS: string[][] = [
  ['leden', 'ledn', 'januar', 'january', 'jan'],
  ['unor', 'unor', 'februar', 'february', 'feb'],
  ['brez', 'marec', 'marc', 'march', 'mar'],
  ['duben', 'dubn', 'april', 'apr'],
  ['kvet', 'maj', 'may'],
  ['cerven', 'cervn', 'jun', 'june'],
  ['cervenec', 'cervenc', 'jul', 'july'],
  ['srpen', 'srpn', 'august', 'aug'],
  ['zari', 'september', 'sep'],
  ['rijen', 'rijn', 'oktober', 'october', 'oct', 'okt'],
  ['listopad', 'november', 'nov'],
  ['prosinec', 'prosinc', 'december', 'dec']
];

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthRange = (y: number, m: number) => ({ from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) });

function parsePeriod(text: string, now: Date): { from: string; to: string; label: string; consumed: RegExp } | null {
  const y = now.getFullYear();
  const m = now.getMonth();
  const rules: [RegExp, () => { from: string; to: string }][] = [
    [/\b(tento mesiac|tento mesic|this month)\b/, () => monthRange(y, m)],
    [/\b(minuly mesiac|minuly mesic|minulej mesic|last month|predchozi mesic)\b/, () => monthRange(y, m - 1)],
    [/\b(letos|tento rok|tohto roku|this year)\b/, () => ({ from: `${y}-01-01`, to: `${y}-12-31` })],
    [/\b(loni|minuly rok|vlani|last year)\b/, () => ({ from: `${y - 1}-01-01`, to: `${y - 1}-12-31` })],
    [/\b(tento tyden|tento tyzden|this week)\b/, () => {
      const start = new Date(now);
      start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return { from: iso(start), to: iso(end) };
    }],
    [/\b(dnes|today)\b/, () => ({ from: iso(now), to: iso(now) })]
  ];
  for (const [re, range] of rules) {
    const hit = text.match(re);
    if (hit) return { ...range(), label: hit[0], consumed: re };
  }
  const quarter = text.match(/\b(q([1-4])|([1-4])\.? ?(ctvrtleti|stvrtrok|quarter))\b(?: ?(\d{4}))?/);
  if (quarter) {
    const q = Number(quarter[2] ?? quarter[3]) - 1;
    const year = quarter[5] ? Number(quarter[5]) : y;
    return { from: iso(new Date(year, q * 3, 1)), to: iso(new Date(year, q * 3 + 3, 0)), label: quarter[0], consumed: /\b(q[1-4]|[1-4]\.? ?(ctvrtleti|stvrtrok|quarter))\b(?: ?\d{4})?/ };
  }
  const words = text.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const w = words[i] ?? '';
    // Longest stems first, so "cervenec" (July) wins over "cerven" (June).
    let best = -1;
    let bestLen = 0;
    MONTHS.forEach((stems, idx) => {
      // 3-letter abbreviations ("nov", "dec") must match exactly — "novak" is a name.
      for (const s of stems) if (s.length >= 3 && (s.length > 3 ? w.startsWith(s) : w === s) && s.length > bestLen) {
        best = idx;
        bestLen = s.length;
      }
    });
    if (best >= 0 && (w.length <= bestLen + 3)) {
      const next = words[i + 1];
      const year = next && /^\d{4}$/.test(next) ? Number(next) : best > m ? y - 1 : y;
      const r = monthRange(year, best);
      const consumed = new RegExp(`\\b${w}\\b(?: ${year})?`);
      return { ...r, label: `${w}${next && /^\d{4}$/.test(next) ? ` ${next}` : ''}`, consumed };
    }
  }
  const year = text.match(/\b(20\d{2})\b/);
  if (year?.[1]) return { from: `${year[1]}-01-01`, to: `${year[1]}-12-31`, label: year[1], consumed: new RegExp(`\\b${year[1]}\\b`) };
  return null;
}

// Filler words that never mean a customer.
const FILLER = new Set(
  'faktura faktury faktur fakturu faktúra faktúry doklad doklady invoice invoices za od pro pre do v ve na a i s se z ze mi moje vsechny vsetky all show ukaz najdi najit find hledej kde ktere ktore ktery mesic mesiac rok roku the in from for of by'.split(' ').map(strip)
);

export function parseInvoiceQuery(raw: string, customers: string[], now = new Date()): NlInvoiceQuery {
  let text = ` ${strip(raw)} `.replace(/[,.;!?]/g, ' ').replace(/\s+/g, ' ');
  const out: NlInvoiceQuery = { understood: [] };

  for (const [re, status] of STATUS_WORDS) {
    const hit = text.match(re);
    if (hit) {
      out.status = status;
      out.understood.push({ kind: 'status', value: status });
      text = text.replace(re, ' ');
      break;
    }
  }
  for (const [re, type] of TYPE_WORDS) {
    if (re.test(text)) {
      out.type = type;
      out.understood.push({ kind: 'type', value: type });
      text = text.replace(re, ' ');
      break;
    }
  }
  for (const [re, cur] of CURRENCY_WORDS) {
    if (re.test(text)) {
      out.currency = cur;
      out.understood.push({ kind: 'currency', value: cur });
      text = text.replace(re, ' ');
      break;
    }
  }
  if (/\b(splatn\w*|due)\b/.test(text) && out.status !== 'overdue') out.date_field = 'due';
  else if (/\b(zaplacen\w* v|paid in)\b/.test(text)) out.date_field = 'paid';
  text = text.replace(/\b(splatn\w*|due)\b/g, ' ');
  const period = parsePeriod(text.trim(), now);
  if (period) {
    out.from = period.from;
    out.to = period.to;
    out.date_field ??= out.status === 'paid' ? 'paid' : 'issue';
    out.understood.push({ kind: 'period', value: `${period.from} – ${period.to}` });
    text = ` ${text.trim().replace(period.consumed, ' ')} `;
  }

  const rest = text
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w) && !/^\d+$/.test(w))
    .join(' ')
    .trim();
  if (rest) {
    const best = customers
      .map((name) => ({ name, score: fuzzyScore(rest, [name]) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)[0];
    if (best) {
      out.contactName = best.name;
      out.q = best.name;
      out.understood.push({ kind: 'customer', value: best.name });
    } else {
      out.q = rest.slice(0, 100);
      out.understood.push({ kind: 'text', value: out.q });
    }
  }
  return out;
}

export function invoiceQueryHref(q: NlInvoiceQuery): string {
  const params = new URLSearchParams();
  for (const key of ['status', 'type', 'currency', 'date_field', 'from', 'to', 'q'] as const) {
    const v = q[key];
    if (v) params.set(key, v);
  }
  const s = params.toString();
  return s ? `/invoices?${s}` : '/invoices';
}
