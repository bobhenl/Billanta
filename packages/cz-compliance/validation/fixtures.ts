/**
 * Representative documents for the schematron run: one per kind of invoice
 * our users send, each built through `generateUblInvoiceXml` exactly as the
 * apps do.
 */
import type { IsdocInvoiceInput, IsdocParty } from '../src/isdoc-generator.js';
import type { UblOptions } from '../src/ubl-generator.js';

export interface Fixture {
  name: string;
  input: IsdocInvoiceInput;
  options?: UblOptions;
}

const skSupplier: IsdocParty = {
  legalName: 'Dodávateľ s.r.o.',
  ico: '12345678',
  dic: 'SK2020123456',
  isVatPayer: true,
  address: { street: 'Hlavná', houseNumber: '1', city: 'Bratislava', postalCode: '81101', countryCode: 'SK' },
  email: 'fakturacia@dodavatel.sk',
  phone: '+421 900 123 456'
};

const skCustomer: IsdocParty = {
  legalName: 'Odberateľ & syn a.s.',
  ico: '87654321',
  dic: 'SK2020654321',
  isVatPayer: true,
  address: { street: 'Nová', houseNumber: '5', city: 'Košice', postalCode: '04001', countryCode: 'SK' },
  contactName: 'Ján Novák'
};

const czSupplier: IsdocParty = {
  legalName: 'Dodavatel s.r.o.',
  ico: '27082440',
  dic: 'CZ27082440',
  isVatPayer: true,
  address: { street: 'Vinohradská', houseNumber: '1511/230', city: 'Praha', postalCode: '10000', countryCode: 'CZ' },
  email: 'fakturace@dodavatel.cz'
};

const czCustomer: IsdocParty = {
  legalName: 'Odběratel a.s.',
  ico: '00006947',
  dic: 'CZ00006947',
  isVatPayer: true,
  address: { street: 'Letenská', houseNumber: '525/15', city: 'Praha', postalCode: '11800', countryCode: 'CZ' }
};

const skBank = { iban: 'SK31 1200 0000 1987 4263 7541', bic: 'TATRSKBX' };
const czBank = { accountNumber: '19-2000145399/0800', iban: 'CZ65 0800 0000 1920 0014 5399', bic: 'GIBACZPX' };

export const FIXTURES: Fixture[] = [
  {
    name: 'sk-domestic-invoice',
    input: {
      invoiceNumber: '2027001',
      variableSymbol: '2027001',
      issueDate: '2027-01-15',
      dueDate: '2027-01-29',
      taxableSupplyDate: '2027-01-15',
      currency: 'EUR',
      supplier: skSupplier,
      customer: skCustomer,
      lineItems: [{ description: 'Konzultácia', quantity: 3, unit: 'hod', unitPriceWithoutVat: 60, vatRate: 'base', vatRatePercent: 23 }],
      totals: { totalWithoutVat: 180, totalVat: 41.4, totalWithVat: 221.4, vatRecapitulation: [] },
      bankAccount: skBank,
      orderNumber: 'OBJ-77'
    }
  },
  {
    name: 'sk-credit-note',
    input: {
      invoiceNumber: 'D2027001',
      variableSymbol: '2027001',
      issueDate: '2027-02-03',
      dueDate: '2027-02-17',
      taxableSupplyDate: '2027-02-03',
      currency: 'EUR',
      supplier: skSupplier,
      customer: skCustomer,
      // The dashboard stores a credit note's lines with negative quantities.
      lineItems: [{ description: 'Konzultácia – dobropis', quantity: -1, unit: 'hod', unitPriceWithoutVat: 60, vatRate: 'base', vatRatePercent: 23 }],
      totals: { totalWithoutVat: -60, totalVat: -13.8, totalWithVat: -73.8, vatRecapitulation: [] },
      bankAccount: skBank,
      note: 'Oprava faktúry 2027001'
    },
    options: { documentType: 'credit_note', precedingInvoice: { number: '2027001', issueDate: '2027-01-15' } }
  },
  {
    name: 'cz-invoice',
    input: {
      invoiceNumber: 'FV2027-0042',
      variableSymbol: '20270042',
      issueDate: '2027-03-01',
      dueDate: '2027-03-15',
      taxableSupplyDate: '2027-02-28',
      currency: 'CZK',
      supplier: czSupplier,
      customer: czCustomer,
      lineItems: [{ description: 'Vývoj webové aplikace', quantity: 12.5, unit: 'hod', unitPriceWithoutVat: 1200, vatRate: 'base', vatRatePercent: 21 }],
      totals: { totalWithoutVat: 15000, totalVat: 3150, totalWithVat: 18150, vatRecapitulation: [] },
      bankAccount: czBank
    },
    options: { prepaidAmount: 5000 }
  },
  {
    name: 'reverse-charge-invoice',
    input: {
      invoiceNumber: 'FV2027-0043',
      variableSymbol: '20270043',
      issueDate: '2027-03-02',
      dueDate: '2027-03-16',
      taxableSupplyDate: '2027-03-02',
      currency: 'EUR',
      supplier: czSupplier,
      customer: {
        legalName: 'Kunde GmbH',
        dic: 'DE123456789',
        isVatPayer: true,
        address: { street: 'Hauptstraße', houseNumber: '7', city: 'Berlin', postalCode: '10115', countryCode: 'DE' }
      },
      lineItems: [{ description: 'Software development services', quantity: 20, unit: 'hod', unitPriceWithoutVat: 55, vatRate: 'base', vatRatePercent: 21 }],
      totals: { totalWithoutVat: 1100, totalVat: 0, totalWithVat: 1100, vatRecapitulation: [] },
      bankAccount: czBank
    },
    options: { reverseCharge: true }
  },
  {
    name: 'multiple-vat-rates-invoice',
    input: {
      invoiceNumber: 'FV2027-0044',
      variableSymbol: '20270044',
      issueDate: '2027-03-03',
      dueDate: '2027-03-17',
      taxableSupplyDate: '2027-03-03',
      currency: 'CZK',
      supplier: czSupplier,
      customer: czCustomer,
      lineItems: [
        { description: 'Notebook', quantity: 1, unit: 'ks', unitPriceWithoutVat: 18990.5, vatRate: 'base', vatRatePercent: 21 },
        { description: 'Kniha', quantity: 3, unit: 'ks', unitPriceWithoutVat: 349.9, vatRate: 'reduced', vatRatePercent: 12 },
        { description: 'Montáž', quantity: 1.5, unit: 'hod', unitPriceWithoutVat: 850, vatRate: 'base', vatRatePercent: 21 },
        { description: 'Poštovné', quantity: 1, unit: 'ks', unitPriceWithoutVat: 89, vatRate: 'zero', vatRatePercent: 0 }
      ],
      // Rounded to whole crowns, as Czech invoices paid in cash or by QR
      // commonly are; the generator reports the difference as cash rounding.
      totals: { totalWithoutVat: 21404.2, totalVat: 4469.58, totalWithVat: 25874, vatRecapitulation: [] },
      bankAccount: czBank
    }
  },
  {
    // A discount entered as its own line with a negative price, and a unit
    // price with more decimals than UBL's PriceAmount keeps.
    name: 'sk-discount-and-fine-price-invoice',
    input: {
      invoiceNumber: '2027002',
      variableSymbol: '2027002',
      issueDate: '2027-01-20',
      dueDate: '2027-02-03',
      taxableSupplyDate: '2027-01-20',
      currency: 'EUR',
      supplier: skSupplier,
      customer: skCustomer,
      lineItems: [
        { description: 'Elektrina', quantity: 1000, unit: 'kWh', unitPriceWithoutVat: 0.123456, vatRate: 'base', vatRatePercent: 23 },
        { description: 'Tretina mesačného paušálu', quantity: 1 / 3, unit: 'mes', unitPriceWithoutVat: 100, vatRate: 'base', vatRatePercent: 23 },
        { description: 'Zľava 10 %', quantity: 1, unitPriceWithoutVat: -15.68, vatRate: 'base', vatRatePercent: 23 }
      ],
      totals: { totalWithoutVat: 141.11, totalVat: 32.46, totalWithVat: 173.57, vatRecapitulation: [] },
      bankAccount: skBank,
      note: 'Ďakujeme za objednávku.'
    }
  },
  {
    // A correction that credits one line and adds back a smaller one.
    name: 'sk-mixed-credit-note',
    input: {
      invoiceNumber: 'D2027002',
      issueDate: '2027-02-05',
      dueDate: '2027-02-19',
      taxableSupplyDate: '2027-02-05',
      currency: 'EUR',
      supplier: skSupplier,
      customer: skCustomer,
      lineItems: [
        { description: 'Konzultácia – storno', quantity: -3, unit: 'hod', unitPriceWithoutVat: 60, vatRate: 'base', vatRatePercent: 23 },
        { description: 'Konzultácia – správne', quantity: 2, unit: 'hod', unitPriceWithoutVat: 60, vatRate: 'base', vatRatePercent: 23 },
        { description: 'Kniha – vrátená', quantity: -1, unit: 'ks', unitPriceWithoutVat: 10.5, vatRate: 'reduced', vatRatePercent: 5 }
      ],
      totals: { totalWithoutVat: -70.5, totalVat: -14.33, totalWithVat: -84.83, vatRecapitulation: [] },
      bankAccount: skBank
    },
    options: { documentType: 'credit_note', precedingInvoice: { number: '2027001' } }
  },
  {
    name: 'cz-non-vat-payer-invoice',
    input: {
      invoiceNumber: '2027007',
      variableSymbol: '2027007',
      issueDate: '2027-03-04',
      dueDate: '2027-03-18',
      taxableSupplyDate: '2027-03-04',
      currency: 'CZK',
      supplier: { ...czSupplier, legalName: 'Jana Nováková', ico: '12345679', dic: 'CZ12345679', isVatPayer: false },
      customer: czCustomer,
      lineItems: [{ description: 'Grafický návrh loga', quantity: 1, unitPriceWithoutVat: 8000, vatRate: 'zero', vatRatePercent: 0 }],
      totals: { totalWithoutVat: 8000, totalVat: 0, totalWithVat: 8000, vatRecapitulation: [] },
      bankAccount: czBank
    }
  }
];
