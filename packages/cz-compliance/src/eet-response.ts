import { EET_PATTERNS, isRetryableEetError } from './eet-fields.js';

/**
 * Parser for the EET reply (sections 3.4 and 3.5): an <Odpoved> with either
 * <Potvrzeni pok="…"> or <Chyba kod="…">, plus up to ten <Varovani>. A SOAP
 * Fault is possible too (footnote to error 2). Pure string scanning: the
 * reply is small, ASCII-only and has a fixed shape, so a full XML parser
 * would add a dependency for nothing. Namespace prefixes vary, so they are
 * matched loosely.
 */

export interface EetWarning {
  code: number;
  text: string;
}

export type EetResponse =
  | {
      kind: 'confirmed';
      /** Potvrzovací kód evidované tržby, the code EET 2.0 hands back instead of FIK. */
      pok: string;
      uuidZpravy: string | null;
      datPrij: string | null;
      /** true on the playground and in verification mode; such a POK is not valid. */
      test: boolean;
      warnings: EetWarning[];
    }
  | {
      kind: 'error';
      code: number;
      text: string;
      uuidZpravy: string | null;
      datOdmit: string | null;
      test: boolean;
      /** Only error -1 (temporary technical error) asks for a resend. */
      retryable: boolean;
      warnings: EetWarning[];
    }
  | { kind: 'fault'; faultCode: string; faultString: string }
  | { kind: 'unparseable' };

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

const P = '(?:[A-Za-z_][\\w.-]*:)?';

function element(xml: string, name: string): { attrs: Record<string, string>; text: string } | null {
  const re = new RegExp(`<${P}${name}(\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</${P}${name}\\s*>)`);
  const m = re.exec(xml);
  if (!m) return null;
  return { attrs: parseAttrs(m[1] ?? ''), text: decodeEntities((m[2] ?? '').replace(/\s+/g, ' ').trim()) };
}

function elements(xml: string, name: string): { attrs: Record<string, string>; text: string }[] {
  const re = new RegExp(`<${P}${name}(\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</${P}${name}\\s*>)`, 'g');
  return [...xml.matchAll(re)].map((m) => ({
    attrs: parseAttrs(m[1] ?? ''),
    text: decodeEntities((m[2] ?? '').replace(/\s+/g, ' ').trim()),
  }));
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const local = m[1]!.includes(':') && !m[1]!.startsWith('xmlns') ? m[1]!.split(':').pop()! : m[1]!;
    out[local] = decodeEntities(m[2] ?? m[3] ?? '');
  }
  return out;
}

const bool = (v: string | undefined) => v === 'true' || v === '1';

export function parseEetResponse(xml: string): EetResponse {
  const fault = element(xml, 'Fault');
  if (fault) {
    const code = element(xml, 'faultcode')?.text ?? '';
    const str = element(xml, 'faultstring')?.text ?? '';
    return { kind: 'fault', faultCode: code, faultString: str };
  }
  const odpoved = element(xml, 'Odpoved');
  if (!odpoved) return { kind: 'unparseable' };
  const body = /<(?:[\w.-]+:)?Odpoved[\s>][\s\S]*<\/(?:[\w.-]+:)?Odpoved\s*>/.exec(xml)?.[0] ?? xml;
  const hlavicka = element(body, 'Hlavicka')?.attrs ?? {};
  const warnings = elements(body, 'Varovani').map((w) => ({ code: Number(w.attrs.kod_varov), text: w.text }));
  const potvrzeni = element(body, 'Potvrzeni');
  if (potvrzeni) {
    const pok = potvrzeni.attrs.pok ?? '';
    if (!EET_PATTERNS.pok.test(pok)) return { kind: 'unparseable' };
    return {
      kind: 'confirmed',
      pok,
      uuidZpravy: hlavicka.uuid_zpravy ?? null,
      datPrij: hlavicka.dat_prij ?? null,
      test: bool(potvrzeni.attrs.test),
      warnings,
    };
  }
  const chyba = element(body, 'Chyba');
  if (chyba && /^-?\d{1,3}$/.test(chyba.attrs.kod ?? '')) {
    const code = Number(chyba.attrs.kod);
    return {
      kind: 'error',
      code,
      text: chyba.text,
      uuidZpravy: hlavicka.uuid_zpravy ?? null,
      datOdmit: hlavicka.dat_odmit ?? null,
      test: bool(chyba.attrs.test),
      retryable: isRetryableEetError(code),
      warnings,
    };
  }
  return { kind: 'unparseable' };
}
