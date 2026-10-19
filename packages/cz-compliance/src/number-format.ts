/**
 * Document number patterns ("formát číslování"), shared by the backend
 * (allocation at issuance, import) and the settings page (live preview).
 *
 * A pattern is literal text around tokens:
 *   {YYYY} 2026   {YY} 26   {MM} 01–12
 *   {N} 7 (no padding)   {NN} 07   {NNN} 007   {NNNN} 0007   {NNNNN} 00007
 *
 * It must contain exactly one sequence token and exactly one year token, so
 * numbers stay unique from one year to the next. A pattern with {MM} gets a
 * new counter every month, any other pattern every year.
 */

export type NumberDocumentType = 'invoice' | 'proforma' | 'credit_note' | 'quote';

export const NUMBER_DOCUMENT_TYPES: readonly NumberDocumentType[] = ['invoice', 'proforma', 'credit_note', 'quote'];

/** Prefix of the built-in format per document type: `2026-0001`, `ZF2026-0001`, `OD…`, `NA…`. */
export const DEFAULT_NUMBER_SERIES: Record<NumberDocumentType, string> = {
  invoice: '',
  proforma: 'ZF',
  credit_note: 'OD',
  quote: 'NA',
};

/** The built-in pattern, which renders exactly what the app always issued. */
export function defaultNumberPattern(type: NumberDocumentType): string {
  return `${DEFAULT_NUMBER_SERIES[type]}{YYYY}-{NNNN}`;
}

export const NUMBER_PATTERN_PRESETS = ['{YYYY}-{NNNN}', '{N}/{MM}/{YYYY}', 'FV{YYYY}{NNN}', '{YY}{NNNN}'] as const;

/** `invoices.invoice_number` is varchar(32). */
export const MAX_INVOICE_NUMBER_LENGTH = 32;

/** The longest sequence a pattern must still fit (checked when the pattern is saved). */
const LONGEST_SEQUENCE = 999_999;

export type NumberPatternError =
  | 'empty'
  | 'invalid_character'
  | 'unknown_token'
  | 'no_sequence'
  | 'multiple_sequences'
  | 'no_year'
  | 'multiple_years'
  | 'multiple_months'
  | 'too_long';

export type NumberPatternPart =
  | { kind: 'literal'; text: string }
  | { kind: 'year4' }
  | { kind: 'year2' }
  | { kind: 'month' }
  | { kind: 'sequence'; width: number };

export type ParsedNumberPattern = { ok: true; parts: NumberPatternPart[] } | { ok: false; error: NumberPatternError };

const LITERAL = /^[A-Za-z0-9\-/._ ]+$/;

export function parseNumberPattern(pattern: string): ParsedNumberPattern {
  if (!pattern.trim()) return { ok: false, error: 'empty' };
  const parts: NumberPatternPart[] = [];
  const re = /\{([^{}]*)\}/g;
  let last = 0;
  let match: RegExpExecArray | null;
  const pushLiteral = (text: string) => {
    if (!text) return true;
    if (!LITERAL.test(text)) return false;
    parts.push({ kind: 'literal', text });
    return true;
  };
  while ((match = re.exec(pattern))) {
    if (!pushLiteral(pattern.slice(last, match.index))) return { ok: false, error: 'invalid_character' };
    const token = match[1]!;
    if (token === 'YYYY') parts.push({ kind: 'year4' });
    else if (token === 'YY') parts.push({ kind: 'year2' });
    else if (token === 'MM') parts.push({ kind: 'month' });
    else if (/^N{1,5}$/.test(token)) parts.push({ kind: 'sequence', width: token.length });
    else return { ok: false, error: 'unknown_token' };
    last = match.index + match[0].length;
  }
  if (!pushLiteral(pattern.slice(last))) return { ok: false, error: 'invalid_character' };

  const count = (kinds: NumberPatternPart['kind'][]) => parts.filter((p) => kinds.includes(p.kind)).length;
  const sequences = count(['sequence']);
  if (sequences === 0) return { ok: false, error: 'no_sequence' };
  if (sequences > 1) return { ok: false, error: 'multiple_sequences' };
  const years = count(['year4', 'year2']);
  if (years === 0) return { ok: false, error: 'no_year' };
  if (years > 1) return { ok: false, error: 'multiple_years' };
  if (count(['month']) > 1) return { ok: false, error: 'multiple_months' };
  if (renderParts(parts, { year: 2026, month: 12, sequence: LONGEST_SEQUENCE }).length > MAX_INVOICE_NUMBER_LENGTH) {
    return { ok: false, error: 'too_long' };
  }
  return { ok: true, parts };
}

/** `null` when the pattern can be saved, else why not. */
export function validateNumberPattern(pattern: string): NumberPatternError | null {
  const parsed = parseNumberPattern(pattern);
  return parsed.ok ? null : parsed.error;
}

export type NumberResetPeriod = 'monthly' | 'yearly';

/** Monthly when the pattern shows the month, else yearly. */
export function numberResetPeriod(pattern: string): NumberResetPeriod {
  const parsed = parseNumberPattern(pattern);
  return parsed.ok && parsed.parts.some((p) => p.kind === 'month') ? 'monthly' : 'yearly';
}

/**
 * The counter a document issued on `date` takes its number from: `month` is 0
 * for a yearly counter. Uses the same local-time year as issuance always did.
 */
export function numberPeriod(pattern: string, date: Date): { year: number; month: number } {
  const year = date.getFullYear();
  return { year, month: numberResetPeriod(pattern) === 'monthly' ? date.getMonth() + 1 : 0 };
}

export interface NumberParts {
  year: number;
  /** 1–12; ignored by a pattern without {MM}. */
  month: number;
  sequence: number;
}

function renderParts(parts: NumberPatternPart[], { year, month, sequence }: NumberParts): string {
  return parts
    .map((p) => {
      switch (p.kind) {
        case 'literal':
          return p.text;
        case 'year4':
          return String(year).padStart(4, '0');
        case 'year2':
          return String(year % 100).padStart(2, '0');
        case 'month':
          return String(month).padStart(2, '0');
        case 'sequence':
          return String(sequence).padStart(p.width, '0');
      }
    })
    .join('');
}

/** Renders a number; throws on an invalid pattern (they are validated when saved). */
export function renderDocumentNumber(pattern: string, values: NumberParts): string {
  const parsed = parseNumberPattern(pattern);
  if (!parsed.ok) throw new Error(`Invalid number pattern "${pattern}": ${parsed.error}`);
  return renderParts(parsed.parts, values);
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

/**
 * Reads year, month and sequence back out of a number written in `pattern`,
 * e.g. `1/10/2026` with `{N}/{MM}/{YYYY}` → { year: 2026, month: 10, sequence: 1 }.
 * `month` is 0 for a pattern without {MM}. The month may be one digit, as
 * some tools write `1/1/2026`. Returns null when the number does not fit.
 */
export function parseDocumentNumber(pattern: string, number: string): NumberParts | null {
  const parsed = parseNumberPattern(pattern);
  if (!parsed.ok) return null;
  const order: NumberPatternPart['kind'][] = [];
  const source = parsed.parts
    .map((p) => {
      if (p.kind === 'literal') return escapeRegExp(p.text);
      order.push(p.kind);
      if (p.kind === 'year4') return '(\\d{4})';
      if (p.kind === 'year2') return '(\\d{2})';
      if (p.kind === 'month') return '(\\d{1,2})';
      return p.width === 1 ? '(\\d+)' : `(\\d{${p.width},})`;
    })
    .join('');
  const match = new RegExp(`^${source}$`).exec(number);
  if (!match) return null;
  const out: NumberParts = { year: 0, month: 0, sequence: 0 };
  order.forEach((kind, i) => {
    const value = Number(match[i + 1]);
    if (kind === 'year4') out.year = value;
    else if (kind === 'year2') out.year = 2000 + value;
    else if (kind === 'month') out.month = value;
    else out.sequence = value;
  });
  if (order.includes('month') && (out.month < 1 || out.month > 12)) return null;
  if (out.sequence < 1) return null;
  return out;
}

export type NumberFormats = Partial<Record<NumberDocumentType, string>>;

/** The pattern a document type uses: the company's own, else the built-in one. */
export function effectiveNumberPattern(formats: NumberFormats | null | undefined, type: NumberDocumentType): string {
  return formats?.[type] || defaultNumberPattern(type);
}

/**
 * Two document types with the same pattern would hand out the same number
 * from two separate counters. Returns the later type of the first such pair,
 * or null.
 */
export function findNumberPatternClash(formats: NumberFormats | null | undefined): NumberDocumentType | null {
  const seen = new Set<string>();
  for (const type of NUMBER_DOCUMENT_TYPES) {
    const pattern = effectiveNumberPattern(formats, type);
    if (seen.has(pattern)) return type;
    seen.add(pattern);
  }
  return null;
}

export interface NumberSample {
  number: string;
  /** The document's issue date; the year (and month) a pattern reads must match it. */
  issueDate: Date;
}

/** At most this many distinct number shapes are tried as candidates. */
const MAX_CANDIDATE_SAMPLES = 12;
/** Share of the numbers a guessed pattern must read, with the right year. */
const MIN_PATTERN_COVERAGE = 0.9;

const sequenceTokens = (digits: string): string[] => {
  if (!digits || digits.length > 6) return [];
  const padded = digits.length <= 5 ? `{${'N'.repeat(digits.length)}}` : null;
  // Leading zero: the source pads to that width. Otherwise it may not pad at all.
  if (digits.startsWith('0')) return padded ? [padded] : [];
  return padded && digits.length > 1 ? [padded, '{N}'] : ['{N}'];
};

/** What one run of digits in a number could be, given when the document was issued. */
function digitRunTokens(run: string, year: number, month: number): string[] {
  const yyyy = String(year);
  const yy = String(year % 100).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  const out: string[] = [...sequenceTokens(run)];
  if (run === yyyy) out.push('{YYYY}');
  if (run === yy) out.push('{YY}');
  if (run === mm || run === String(month)) out.push('{MM}');
  for (const [prefix, token] of [
    [yyyy, '{YYYY}'],
    [yy, '{YY}'],
  ] as const) {
    if (!run.startsWith(prefix) || run.length === prefix.length) continue;
    const rest = run.slice(prefix.length);
    for (const seq of sequenceTokens(rest)) out.push(token + seq);
    if (rest.startsWith(mm) && rest.length > 2) for (const seq of sequenceTokens(rest.slice(2))) out.push(token + '{MM}' + seq);
  }
  return out;
}

/** Every valid pattern that renders `number` as issued on `date`. */
function candidatePatterns(number: string, date: Date): string[] {
  const runs = number.match(/\d+|\D+/g) ?? [];
  let patterns = [''];
  for (const run of runs) {
    if (/^\d/.test(run)) {
      const tokens = digitRunTokens(run, date.getUTCFullYear(), date.getUTCMonth() + 1);
      patterns = patterns.flatMap((p) => tokens.map((t) => p + t));
    } else {
      if (!LITERAL.test(run)) return [];
      patterns = patterns.map((p) => p + run);
    }
    if (patterns.length > 200) return [];
  }
  return patterns.filter((p) => validateNumberPattern(p) === null);
}

/** Does `number` read in `pattern` with the year (and month) it was issued in? */
function fitsSample(pattern: string, sample: NumberSample): boolean {
  const parts = parseDocumentNumber(pattern, sample.number);
  if (!parts) return false;
  if (parts.year !== sample.issueDate.getUTCFullYear()) return false;
  return parts.month === 0 || parts.month === sample.issueDate.getUTCMonth() + 1;
}

/**
 * Guesses the pattern a list of numbers from another invoicing tool was
 * written in (`FV2025017` → `FV{YYYY}{NNN}`, `1/10/2025` → `{N}/{MM}/{YYYY}`),
 * so the company can carry on in the same row after an import. Null when no
 * single pattern reads at least 90 % of them with the right year.
 *
 * Ties go to a yearly counter over a monthly one, then to the padded width
 * the source used.
 */
export function inferNumberPattern(samples: NumberSample[]): string | null {
  if (samples.length === 0) return null;
  const shapes = new Map<string, NumberSample>();
  for (const s of samples) {
    const shape = s.number.replace(/\d/g, '9');
    if (!shapes.has(shape)) shapes.set(shape, s);
    if (shapes.size >= MAX_CANDIDATE_SAMPLES) break;
  }
  const candidates = new Set<string>();
  for (const s of shapes.values()) for (const p of candidatePatterns(s.number, s.issueDate)) candidates.add(p);

  let best: { pattern: string; hits: number; monthly: boolean; width: number } | null = null;
  for (const pattern of candidates) {
    const hits = samples.filter((s) => fitsSample(pattern, s)).length;
    if (hits / samples.length < MIN_PATTERN_COVERAGE) continue;
    const monthly = pattern.includes('{MM}');
    const width = /\{(N+)\}/.exec(pattern)?.[1]?.length ?? 0;
    const better =
      !best ||
      hits > best.hits ||
      (hits === best.hits && (best.monthly && !monthly || (best.monthly === monthly && width > best.width)));
    if (better) best = { pattern, hits, monthly, width };
  }
  return best?.pattern ?? null;
}
