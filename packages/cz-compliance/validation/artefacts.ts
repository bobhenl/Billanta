/**
 * Official rule sets and the tools to run them, pinned by URL and SHA-256.
 *
 * OpenPeppol publishes BIS Billing 3.0 rules only as Schematron, together
 * with the CEN EN 16931 UBL Schematron it enforces (the CEN version is the
 * one bundled in the Peppol release, so we test what access points run).
 * We compile both to XSLT with SchXslt and run them with Saxon-HE, the
 * processor the official XSLT artefacts are built and tested with. The
 * OASIS UBL 2.1 XSD is checked too (XsdValidate.java). Nothing
 * goes to an online validator: files come from the Peppol GitHub tag and
 * Maven Central and OASIS, are checked against the hashes below and cached in
 * `validation/.cache`.
 *
 * To upgrade, change the version, delete the cache and put the new hashes
 * here (the error message prints them).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

export const PEPPOL_BIS_VERSION = 'v3.0.20';

const PEPPOL_RULES = `https://raw.githubusercontent.com/OpenPEPPOL/peppol-bis-invoice-3/${PEPPOL_BIS_VERSION}/rules/sch`;
const MAVEN = 'https://repo1.maven.org/maven2';

interface Artefact {
  file: string;
  url: string;
  sha256: string;
}

const ARTEFACTS = {
  cen: {
    file: 'CEN-EN16931-UBL.sch',
    url: `${PEPPOL_RULES}/CEN-EN16931-UBL.sch`,
    sha256: 'bdcbb7b702cce55c7f8c789bef0cb9bebf6d376140c1776e683bd6d9bc0ad331'
  },
  peppol: {
    file: 'PEPPOL-EN16931-UBL.sch',
    url: `${PEPPOL_RULES}/PEPPOL-EN16931-UBL.sch`,
    sha256: '5ddf3a2f6633147b20b7805df9902d825af1a984f10014fcee186d4170364b1d'
  },
  saxon: {
    file: 'Saxon-HE-12.5.jar',
    url: `${MAVEN}/net/sf/saxon/Saxon-HE/12.5/Saxon-HE-12.5.jar`,
    sha256: '98c3a91e6e5aaf9b3e2b37601e04b214a6e67098493cdd8232fcb705fddcb674'
  },
  // Saxon 12 needs it on the classpath to resolve URIs.
  xmlresolver: {
    file: 'xmlresolver-5.2.2.jar',
    url: `${MAVEN}/org/xmlresolver/xmlresolver/5.2.2/xmlresolver-5.2.2.jar`,
    sha256: 'efc92bd7ed32b3e57095e0b3e872051ccfbbdcc980831ef33e89e38161a85222'
  },
  // Official UBL 2.1 schemas (OASIS Standard, 4 November 2013).
  ublXsd: {
    file: 'UBL-2.1.zip',
    url: 'https://docs.oasis-open.org/ubl/os-UBL-2.1/UBL-2.1.zip',
    sha256: '60b80d76394a8a2add90723ecb8e0e2e9d826775de9749df37a72d60703f86ed'
  },
  schxslt: {
    file: 'schxslt-1.10.1.jar',
    url: `${MAVEN}/name/dmaus/schxslt/schxslt/1.10.1/schxslt-1.10.1.jar`,
    sha256: '4f4f21edab7b37f96ad59ae12a344d3510f1092ac46b6d81a4efa0120b73cb58'
  }
} satisfies Record<string, Artefact>;

export type RuleSet = 'cen' | 'peppol';

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

async function fetchVerified(cacheDir: string, artefact: Artefact): Promise<string> {
  const path = join(cacheDir, artefact.file);
  if (existsSync(path) && sha256(readFileSync(path)) === artefact.sha256) return path;
  const response = await fetch(artefact.url);
  if (!response.ok) throw new Error(`Download of ${artefact.url} failed: HTTP ${response.status}`);
  const data = new Uint8Array(await response.arrayBuffer());
  const actual = sha256(data);
  if (actual !== artefact.sha256) {
    throw new Error(`Checksum mismatch for ${artefact.url}: expected ${artefact.sha256}, got ${actual}`);
  }
  writeFileSync(path, data);
  return path;
}

function runJava(classpath: string[], args: string[]): string {
  const cp = classpath.length ? ['-cp', classpath.join(delimiter)] : [];
  const result = spawnSync('java', [...cp, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`Could not start java (a JDK 11+ is required): ${result.error.message}`);
  if (result.status !== 0) throw new Error(`java ${args.join(' ')} failed:\n${result.stderr}`);
  return result.stdout;
}

export interface Validator {
  classpath: string[];
  ublZip: string;
  /** Compiled XSLT per rule set. */
  xslt: Record<RuleSet, string>;
}

/** Downloads (or reuses) the pinned artefacts and compiles each Schematron to XSLT once. */
export async function prepareValidator(cacheDir: string): Promise<Validator> {
  mkdirSync(cacheDir, { recursive: true });
  const [cen, peppol, saxon, xmlresolver, schxslt, ublZip] = await Promise.all(
    [ARTEFACTS.cen, ARTEFACTS.peppol, ARTEFACTS.saxon, ARTEFACTS.xmlresolver, ARTEFACTS.schxslt, ARTEFACTS.ublXsd].map((a) =>
      fetchVerified(cacheDir, a)
    )
  );
  const classpath = [saxon!, xmlresolver!];
  // Saxon reads the SchXslt stylesheets straight out of the jar.
  const pipeline = `jar:${pathToFileURL(schxslt!).href}!/xslt/2.0/pipeline-for-svrl.xsl`;
  const xslt = {} as Record<RuleSet, string>;
  for (const [set, sch, artefact] of [
    ['cen', cen!, ARTEFACTS.cen],
    ['peppol', peppol!, ARTEFACTS.peppol]
  ] as const) {
    // The hash in the name recompiles when the Schematron changes.
    const out = join(cacheDir, `${set}-${artefact.sha256.slice(0, 12)}.xsl`);
    if (!existsSync(out)) runJava(classpath, ['net.sf.saxon.Transform', `-s:${sch}`, `-xsl:${pipeline}`, `-o:${out}`]);
    xslt[set] = out;
  }
  return { classpath, ublZip: ublZip!, xslt };
}

/** Runs one rule set over every XML file in `inputDir`, writing one SVRL report per file to `outputDir`. */
export function validateDirectory(validator: Validator, set: RuleSet, inputDir: string, outputDir: string): void {
  mkdirSync(outputDir, { recursive: true });
  runJava(validator.classpath, ['net.sf.saxon.Transform', `-s:${inputDir}`, `-xsl:${validator.xslt[set]}`, `-o:${outputDir}`]);
}

export interface XsdError {
  file: string;
  position: string;
  message: string;
}

/** Validates the given files against the UBL 2.1 XSD (Invoice or CreditNote, by root element). */
export function validateXsd(validator: Validator, files: string[]): XsdError[] {
  const program = join(dirname(fileURLToPath(import.meta.url)), 'XsdValidate.java');
  return runJava([], [program, validator.ublZip, ...files])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [file = '', position = '', ...message] = line.split('\t');
      return { file, position, message: message.join('\t') };
    });
}

export interface SvrlFinding {
  id: string;
  flag: string;
  location: string;
  text: string;
}

/**
 * Failed asserts and successful reports from an SVRL report. Both mean the
 * rule fired; the `flag` ("fatal" or "warning") says how serious it is.
 */
export function parseSvrl(svrl: string): SvrlFinding[] {
  const findings: SvrlFinding[] = [];
  const pattern = /<svrl:(?:failed-assert|successful-report)\b([^>]*)>([\s\S]*?)<\/svrl:(?:failed-assert|successful-report)>/g;
  for (const match of svrl.matchAll(pattern)) {
    const attrs = match[1] ?? '';
    const attr = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1] ?? '';
    const text = /<svrl:text>([\s\S]*?)<\/svrl:text>/.exec(match[2] ?? '')?.[1] ?? '';
    findings.push({ id: attr('id'), flag: attr('flag'), location: attr('location'), text: text.replace(/\s+/g, ' ').trim() });
  }
  return findings;
}
