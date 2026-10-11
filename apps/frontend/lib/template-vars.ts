/**
 * `{placeholders}` for customer emails and document notes — mirrors
 * backend `tenants/template-vars.ts`. Built-ins are filled from the
 * company, document and customer; the company adds its own in
 * Settings → Proměnné.
 */
export interface TemplateVar {
  key: string;
  value: string;
  label: string | null;
}

export const VAR_KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;
export const MAX_TEMPLATE_VARS = 30;

/** Built-ins by group; `reminder_no` exists only in reminder emails. */
export const BUILTIN_GROUPS = {
  document: ['number', 'amount', 'base', 'vat', 'paid', 'remaining', 'net', 'tax', 'social', 'health', 'insurance', 'due_date', 'issue_date', 'vs', 'link', 'reminder_no'],
  customer: ['customer', 'customer_ico', 'portal_link'],
  company: ['company', 'ico', 'dic', 'company_email', 'phone', 'web', 'address', 'bank_account', 'iban'],
  other: ['today', 'year']
} as const;

export type BuiltinVar = (typeof BUILTIN_GROUPS)[keyof typeof BUILTIN_GROUPS][number];
export const BUILTIN_VARS = Object.values(BUILTIN_GROUPS).flat() as BuiltinVar[];

/**
 * Ready-made variables one click away (Czech, like the documents). The
 * values are starting points the company edits.
 */
export const PRESET_VARS: TemplateVar[] = [
  { key: 'obchodni_podminky', label: 'Obchodní podmínky', value: 'https://www.vasefirma.cz/obchodni-podminky' },
  { key: 'neplatce_dph', label: 'Neplátce DPH', value: 'Nejsem plátce DPH.' },
  { key: 'podekovani', label: 'Poděkování', value: 'Děkujeme za spolupráci a těšíme se na další.' },
  { key: 'jednatel', label: 'Jednatel / podpis', value: 'Jan Novák, jednatel' },
  { key: 'datova_schranka', label: 'Datová schránka', value: 'abc1234' },
  { key: 'penale', label: 'Smluvní pokuta', value: 'Při prodlení s úhradou účtujeme smluvní pokutu 0,05 % z dlužné částky za každý den prodlení.' },
  { key: 'dovolena', label: 'Dovolená', value: 'Od 1. 8. do 15. 8. čerpáme dovolenou, na e-maily odpovíme po návratu.' },
  { key: 'podpora', label: 'Kontakt na podporu', value: 'podpora@vasefirma.cz, +420 777 123 456' }
];

/** Sample values for previews (the email preview, the variables page). */
export function sampleValues(company: { companyName: string; ico?: string | null; dic?: string | null; email?: string | null }, own: TemplateVar[] = []) {
  const now = new Date();
  const builtins: Record<BuiltinVar, string> = {
    number: '2026-0042',
    amount: '12 100,00 Kč',
    base: '10 000,00 Kč',
    vat: '2 100,00 Kč',
    paid: '0,00 Kč',
    remaining: '12 100,00 Kč',
    net: '8 488,00 Kč',
    tax: '600,00 Kč',
    social: '642,40 Kč',
    health: '270,00 Kč',
    insurance: '912,40 Kč',
    due_date: '17. 10. 2026',
    issue_date: '3. 10. 2026',
    vs: '20260042',
    link: 'https://billanta.cz/i/…',
    reminder_no: '1',
    customer: 'Novák Design s.r.o.',
    customer_ico: '27074358',
    portal_link: 'https://billanta.cz/c/…',
    company: company.companyName,
    ico: company.ico ?? '',
    dic: company.dic ?? '',
    company_email: company.email ?? '',
    phone: '+420 777 000 000',
    web: 'www.vasefirma.cz',
    address: 'Dlouhá 1, 110 00 Praha',
    bank_account: '123456789/0100',
    iban: 'CZ65 0800 0000 1920 0014 5399',
    today: now.toLocaleDateString('cs-CZ'),
    year: String(now.getFullYear())
  };
  return { ...Object.fromEntries(own.map((v) => [v.key, v.value])), ...builtins } as Record<string, string>;
}

export const fillSample = (template: string, values: Record<string, string>) =>
  template.replace(/\{([a-z_][a-z0-9_]*)\}/g, (m, key: string) => values[key] ?? m);
