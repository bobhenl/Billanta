/**
 * Runs the generated UBL through the OASIS UBL 2.1 XSD and the official
 * CEN EN 16931 and Peppol BIS Billing 3.0 Schematron rules, and fails on any
 * schema error or fatal finding. Warnings are printed but pass, as they do
 * at a Peppol access point.
 *
 * Needs a JDK 11+ and network access on the first run; see artefacts.ts.
 * `pnpm --filter @faktur/cz-compliance validate:peppol`
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { generateUblInvoiceXml } from '../src/ubl-generator.js';
import {
  parseSvrl,
  prepareValidator,
  validateDirectory,
  validateXsd,
  type RuleSet,
  type SvrlFinding,
  type XsdError
} from './artefacts.js';
import { FIXTURES } from './fixtures.js';

const here = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(here, '.cache');
const workDir = join(cacheDir, 'run');
const RULE_SETS: RuleSet[] = ['cen', 'peppol'];

const first = FIXTURES[0]!;
const firstXml = () => generateUblInvoiceXml(first.input, first.options);

/**
 * Broken copies of a valid document. Each must fail, which shows the
 * pipeline really evaluates the rules instead of passing everything.
 */
const CONTROLS: { name: string; xml: () => string; expect: { xsd?: boolean; rule?: [RuleSet, string] } }[] = [
  {
    name: 'control-wrong-payable',
    xml: () => firstXml().replace(/(<cbc:PayableAmount [^>]*>)[^<]*/, '$11.00'),
    expect: { rule: ['cen', 'BR-CO-16'] }
  },
  {
    name: 'control-no-buyer-reference',
    xml: () => firstXml().replace(/<cbc:BuyerReference>[^<]*<\/cbc:BuyerReference>(<cac:OrderReference>.*?<\/cac:OrderReference>)?/, ''),
    expect: { rule: ['peppol', 'PEPPOL-EN16931-R003'] }
  },
  {
    name: 'control-element-order',
    // IssueDate after DueDate breaks the UBL sequence.
    xml: () => firstXml().replace(/(<cbc:IssueDate>[^<]*<\/cbc:IssueDate>)(<cbc:DueDate>[^<]*<\/cbc:DueDate>)/, '$2$1'),
    expect: { xsd: true }
  }
];

const reports = new Map<string, SvrlFinding[]>();
let xsdErrors: XsdError[] = [];

beforeAll(async () => {
  const validator = await prepareValidator(cacheDir);
  rmSync(workDir, { recursive: true, force: true });
  const docs = join(workDir, 'documents');
  mkdirSync(docs, { recursive: true });
  const documents = [
    ...FIXTURES.map((f) => ({ name: f.name, xml: generateUblInvoiceXml(f.input, f.options) })),
    ...CONTROLS.map((c) => ({ name: c.name, xml: c.xml() }))
  ];
  for (const doc of documents) writeFileSync(join(docs, `${doc.name}.xml`), doc.xml);

  xsdErrors = validateXsd(
    validator,
    documents.map((d) => join(docs, `${d.name}.xml`))
  );
  // One Saxon run per rule set over the whole folder keeps JVM start-ups down.
  for (const set of RULE_SETS) {
    const out = join(workDir, set);
    validateDirectory(validator, set, docs, out);
    for (const doc of documents) {
      reports.set(`${set}/${doc.name}`, parseSvrl(readFileSync(join(out, `${doc.name}.xml`), 'utf8')));
    }
  }
}, 600_000);

const describeFinding = (f: SvrlFinding) => `[${f.id}] ${f.text} (${f.location})`;
const fatal = (set: RuleSet, name: string) => (reports.get(`${set}/${name}`) ?? []).filter((f) => f.flag === 'fatal');

describe.each(FIXTURES.map((f) => f.name))('%s', (name) => {
  it('is valid against the UBL 2.1 schema', () => {
    expect(xsdErrors.filter((e) => e.file === `${name}.xml`).map((e) => `${e.position} ${e.message}`)).toEqual([]);
  });

  it.each(RULE_SETS)('passes the %s rules without fatal errors', (set) => {
    const warnings = (reports.get(`${set}/${name}`) ?? []).filter((f) => f.flag !== 'fatal');
    if (warnings.length) console.warn(`${name} (${set}) warnings:\n  ${warnings.map(describeFinding).join('\n  ')}`);
    expect(fatal(set, name).map(describeFinding)).toEqual([]);
  });
});

describe('negative controls', () => {
  it.each(CONTROLS)('$name is rejected', (control) => {
    if (control.expect.xsd) expect(xsdErrors.some((e) => e.file === `${control.name}.xml`)).toBe(true);
    if (control.expect.rule) {
      const [set, id] = control.expect.rule;
      expect(fatal(set, control.name).map((f) => f.id)).toContain(id);
    }
  });
});
