import type { CountryPack } from '../types.js';
import { usDeadlines, usFederalHolidays } from './calendar.js';
import { validateUsAccount } from './routing.js';
import { US_RATE_SETS, US_STATES } from './sales-tax.js';
import { EIN_SPEC, SSN_ITIN_SPEC } from './tax-ids.js';

export { nextIrsBusinessDay, usDeadlines, usFederalHolidays } from './calendar.js';
export { validateAbaRouting, validateUsAccount } from './routing.js';
export {
  NO_STATE_SALES_TAX,
  reachesEconomicNexus,
  US_ECONOMIC_NEXUS,
  US_RATE_SETS,
  US_STATES,
  usStateRate,
  type UsEconomicNexus,
} from './sales-tax.js';
export { EIN_PREFIXES, isItinShape, isSsnShape, normalizeEin, validateEin } from './tax-ids.js';

/**
 * United States. There is no federal VAT and no federal invoice law: sales
 * tax is a state (and local) matter, and what an invoice must show comes from
 * state sales-tax rules and from what clients' accounts-payable teams expect.
 */
export const US: CountryPack = {
  code: 'US',
  name: 'United States',
  region: 'americas',
  euMember: false,
  currency: 'USD',
  currencyMinorUnits: 2,
  // Six time zones on the mainland plus Alaska and Hawaii; the tenant's own zone must win.
  timeZone: 'America/New_York',
  locales: ['en'],
  subdivisions: US_STATES,
  taxIds: [EIN_SPEC, SSN_ITIN_SPEC],
  indirectTax: {
    kind: 'sales_tax',
    name: { en: 'Sales tax' },
    rateSets: US_RATE_SETS,
    source: { title: 'Streamlined Sales Tax Governing Board', url: 'https://www.streamlinedsalestax.org/' },
  },
  invoice: {
    // No federal statute prescribes invoice content. These are the fields
    // states expect when tax is charged (it must be stated separately from
    // the price in most states) and the ones a client needs to book and pay.
    requirements: [
      { field: 'invoice_number' },
      { field: 'issue_date' },
      { field: 'due_date' },
      { field: 'supplier_name' },
      { field: 'supplier_address' },
      { field: 'customer_name' },
      { field: 'customer_address', when: 'tax_registered', rule: 'ship-to / sold-to address decides the sourcing of sales tax' },
      { field: 'line_description' },
      { field: 'line_quantity' },
      { field: 'line_unit_price' },
      { field: 'tax_amount_per_rate', when: 'tax_registered', rule: 'sales tax stated separately (state sales-tax acts)' },
      { field: 'total_with_tax' },
    ],
    numbering: { gapless: false, multipleSeries: true },
    homeCurrencyTaxRequired: false,
    // IRS: 3 years in general, 6 for a substantial understatement, 7 for bad
    // debts; several states audit sales tax over 4 years. 7 covers them all.
    retentionYears: 7,
    source: {
      title: 'IRS – How long should I keep records?',
      url: 'https://www.irs.gov/businesses/small-businesses-self-employed/how-long-should-i-keep-records',
    },
  },
  // No mandate. The DBNAlliance network (Peppol-based, Business Payments
  // Coalition) is voluntary for B2B; federal agencies take invoices through
  // their own portals (IPP, Treasury).
  einvoicing: [],
  payments: {
    iban: false,
    validateDomesticAccount: validateUsAccount,
    reference: 'free_text',
    localMethods: ['ach', 'card', 'zelle', 'check', 'wire'],
  },
  holidays: usFederalHolidays,
  deadlines: usDeadlines,
  supportLevel: 'pack',
  verifiedAt: '2026-10-28',
  caveats: [
    'Only state-level sales-tax rates are modelled. County, city and special-district rates (often 1–5 % more) are out of scope; a tax API (Stripe Tax, TaxJar, Avalara) is the planned path to combined rates.',
    'Product taxability differs per state (groceries, clothing, SaaS, digital goods, professional services) and is not modelled; many freelancer services are not taxable at all.',
    'Hawaii GET, New Mexico GRT and Arizona TPT are taxes on the seller that are usually passed on; they are stored as sales-tax rates for simplicity.',
    'For states whose current rate has been unchanged for years, validFrom is 2026-01-01 and only means "in force when verified".',
    'Economic nexus thresholds come from vendor summaries (Avalara, TaxCloud, NexusFlag) cross-checked against each other, not from every state revenue department; what counts as sales and the measurement period differ per state.',
    'Kentucky drops the 200-transaction test from 2026-08-01 (HB 757). DC postponed its rise to 7 % to 2027-10-01; sources disagreed on the date.',
    'State sales-tax permit numbers have one format per state and no validator here; the contract has no per-subdivision tax ID.',
    'Resale and exemption certificates (SST certificate, state forms) let a B2B buyer skip sales tax; the seller must keep them on file. Not modelled yet.',
    'Holidays are federal holidays only. States add their own (e.g. Patriots\' Day, Cesar Chavez Day) and a president can close federal offices on extra days by executive order.',
    'The 1099-NEC threshold rises from USD 600 to USD 2,000 for payments made from 2026 (P.L. 119-21); confirm against the final IRS instructions.',
    'timeZone America/New_York is only a default; the US spans six zones.',
    'SSN and ITIN are personal data: validate the shape only, never log them, and store them encrypted if at all.',
  ],
  sources: [
    { title: 'South Dakota v. Wayfair, Inc., 585 U.S. 162 (2018)', url: 'https://www.supremecourt.gov/opinions/17pdf/17-494_j4el.pdf' },
    { title: 'Streamlined Sales Tax Governing Board', url: 'https://www.streamlinedsalestax.org/' },
    { title: 'IRS – Valid EIN prefixes', url: 'https://www.irs.gov/businesses/small-businesses-self-employed/how-eins-are-assigned-and-valid-ein-prefixes' },
    { title: 'IRS – Estimated taxes', url: 'https://www.irs.gov/businesses/small-businesses-self-employed/estimated-taxes' },
    { title: 'IRS – Instructions for Forms 1099-MISC and 1099-NEC', url: 'https://www.irs.gov/instructions/i1099mec' },
    { title: 'OPM – Federal holidays', url: 'https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/' },
    { title: 'Federal Reserve – E-Payments Routing Directory', url: 'https://www.frbservices.org/resources/routing-number-directory' },
    { title: 'DBNAlliance – Digital Business Networks Alliance', url: 'https://dbnalliance.org/' },
    { title: 'Avalara – Kentucky removes its transaction threshold (April 2026)', url: 'https://www.avalara.com/blog/en/north-america/2026/04/kentucky-removes-transaction-threshold-taxes-data-brokering-services.html' },
    { title: 'TaxCloud – Sales tax changes 2026', url: 'https://taxcloud.com/blog/sales-tax-changes-2026/' },
  ],
};
