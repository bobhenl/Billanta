import type { GlossaryTexts } from './types';

/**
 * English texts for every term. Shared terms explain both countries; the
 * Czech-only and Slovak-only terms explain their own country.
 */
export const EN: GlossaryTexts = {
  'vat-payer': {
    term: 'VAT payer and non-payer',
    aka: 'plátce DPH (CZ), platiteľ DPH (SK)',
    definition:
      'A VAT payer is a business registered for value added tax: it adds VAT to its prices, pays it to the state and can deduct the VAT on its purchases. A non-payer adds no VAT to its prices and cannot deduct any.',
    explanation: [
      'Czech Republic: registration becomes compulsory when turnover for a calendar year exceeds CZK 2,000,000, from 1 January of the next year; above CZK 2,536,500 during the year, from the following day (§ 6 of the VAT Act). Voluntary registration is possible too.',
      'Slovakia: registration becomes compulsory when turnover for a calendar year exceeds €50,000, from 1 January of the next year; above €62,500 during the year, from the supply that crossed it (§ 4 of the VAT Act).',
      'In between sits the identified person (CZ) or the person registered under § 7a (SK): not a VAT payer, but it must declare and pay VAT on certain services from other EU countries.'
    ],
    example:
      'A Czech designer who is a VAT payer charges CZK 10,000 for a logo, adds 21 % VAT of CZK 2,100 and invoices CZK 12,100. As a non-payer she would invoice CZK 10,000.',
    match: ['VAT payers?', 'non-payers?']
  },
  'vat-rate': {
    term: 'VAT rate',
    definition:
      'The VAT rate is the percentage applied to the tax base to get the VAT. Czech rates since 1 January 2024 are 21 % and 12 %; Slovak rates since 1 January 2025 are 23 %, 19 % and 5 %. Some supplies are exempt.',
    explanation: [
      'Which rate applies is set by § 47 of the Czech VAT Act and § 27 of the Slovak VAT Act with their annexes. The standard rate applies whenever the law does not set a reduced rate or an exemption.',
      'A VAT payer\'s invoice shows the rate for each line and a VAT summary by rate. Under reverse charge the supplier shows no VAT; the customer calculates it.'
    ],
    example: 'On CZK 500 net, Czech VAT is CZK 105 at 21 % or CZK 60 at 12 %. On €100 net, Slovak VAT is €23 at 23 % or €5 at 5 %.',
    match: ['VAT rates?']
  },
  'tax-base': {
    term: 'Tax base (VAT)',
    definition:
      'The tax base is the amount VAT is calculated from: everything the supplier received or is to receive for the supply, excluding the VAT itself.',
    explanation: [
      'What belongs to it is set by § 36 of the Czech VAT Act and § 22 of the Slovak one. Incidental costs passed on to the customer, such as transport or packaging, are part of it.',
      'For a supply in a foreign currency the tax base is converted at the rate the VAT Act sets. It is corrected with a credit note, never by rewriting the original invoice.'
    ],
    example: 'A carpenter charges CZK 20,000 for a table and CZK 1,000 for delivery, both net of VAT. The tax base is CZK 21,000 and 21 % VAT on it is CZK 4,410.',
    match: ['tax base']
  },
  invoice: {
    term: 'Invoice',
    aka: 'faktura (CZ), faktúra (SK)',
    definition:
      'An invoice is a document in which a supplier bills a customer for goods or services and asks for payment. A VAT payer\'s invoice must also meet the requirements of the VAT Act.',
    explanation: [
      'Every business must show its name, registered address and company ID (IČO) on its invoices, like on all business documents (§ 435 of the Czech Civil Code, § 3a of the Slovak Commercial Code).',
      'In the Czech Republic a VAT payer issues a tax document under § 28 and § 29 of the VAT Act. In Slovakia the invoice itself is the VAT document, issued under § 71 with the particulars of § 74.',
      'A non-payer issues an invoice without VAT. The VAT Act does not apply to it, but the commercial-law details still do.'
    ],
    example:
      'A freelance developer who is not a VAT payer invoices CZK 30,000 for a website. The invoice shows his name, address and IČO, the customer\'s details, the work, the amount, the due date and the bank account.',
    match: ['invoices?']
  },
  'invoice-number': {
    term: 'Invoice number',
    definition:
      'The invoice number identifies the document uniquely within the issuer\'s series. For a VAT payer it is a required particular and must not repeat within a series.',
    explanation: [
      'The Czech VAT Act (§ 29(1)) asks for a registration number assigned in one or more series; the Slovak VAT Act (§ 74(1)) for a serial number that identifies the invoice uniquely. The format is up to the issuer.',
      'The invoice number is often used as the variable symbol of the payment, so incoming payments can be matched to invoices.'
    ],
    example: 'The series 2026001, 2026002, 2026003 … is valid. Two different invoices numbered 2026002 in the same series are not.',
    match: ['invoice numbers?']
  },
  'advance-invoice': {
    term: 'Advance invoice',
    aka: 'pro forma invoice, zálohová faktura',
    definition:
      'An advance invoice is a request to pay a deposit before goods or services are delivered. It is not a VAT document; a VAT payer issues one only once the payment arrives.',
    explanation: [
      'A payment received before the supply creates the duty to declare VAT on the day it is received: § 20a(2) of the Czech VAT Act, § 19(4) of the Slovak one. The payer then issues a VAT document for the received payment.',
      'After delivery a final invoice is issued and the deposit is deducted from it. A non-payer only deals with the payment: an advance invoice first, then the settlement.'
    ],
    example:
      'A photographer asks for a CZK 5,000 deposit before a wedding and sends an advance invoice. When the money arrives, she issues a tax document for it. After the wedding she invoices the full CZK 15,000 less the CZK 5,000 already paid.',
    match: ['advance invoices?', 'pro forma invoices?', 'proforma invoices?']
  },
  'credit-note': {
    term: 'Credit note',
    aka: 'dobropis, opravný daňový doklad (CZ), opravná faktúra (SK)',
    definition:
      'A credit note is a document by which a supplier reduces an amount invoiced earlier, for example after a return, a discount or a mistake. For a VAT payer it corrects the tax base and the VAT as well.',
    explanation: [
      'Czech Republic: the correction is governed by § 42 of the VAT Act and the corrective tax document by § 45. Slovakia: the change of tax base by § 25, and under § 71(2) the corrective document is itself an invoice.',
      'The credit note refers to the original invoice and shows the difference, not a new total. The original invoice is never rewritten or deleted.'
    ],
    example: 'Chairs were invoiced for CZK 12,100 including VAT. The customer returns one, so the supplier issues a credit note for −CZK 2,420 including VAT that refers to the original invoice.',
    match: ['credit notes?']
  },
  'reverse-charge': {
    term: 'Reverse charge',
    aka: 'přenesená daňová povinnost (CZ), prenesenie daňovej povinnosti (SK)',
    definition:
      'Reverse charge is a regime in which the customer, not the supplier, accounts for the VAT. The supplier invoices without VAT and the customer calculates and declares the tax, usually deducting it at the same time.',
    explanation: [
      'Within one country it applies only to supplies the law lists, such as construction work or waste, and only between VAT payers: § 92a to 92i of the Czech VAT Act (construction in § 92e), § 69(12) of the Slovak one. The same principle applies to services and goods between businesses in different EU countries.',
      'The invoice shows the customer\'s VAT number and a note that the customer accounts for the VAT. Domestic reverse-charge supplies go into the control statement.'
    ],
    example:
      'A building firm does construction work for another VAT payer for CZK 100,000. It invoices CZK 100,000 without VAT with the note "daň odvede zákazník", and the customer adds 21 % VAT and declares it.',
    match: ['reverse[- ]charge']
  },
  'recapitulative-statement': {
    term: 'EC Sales List',
    aka: 'souhrnné hlášení (CZ), súhrnný výkaz (SK), recapitulative statement',
    definition:
      'The EC Sales List is a report to the tax office listing supplies of goods and services to businesses in other EU countries. The data are cross-checked across the EU through VIES.',
    explanation: [
      'Czech Republic: § 102 of the VAT Act, filed electronically within 25 days after the month of the supplies. Slovakia: § 80, filed within 25 days after the month, or quarterly under the conditions of § 80.',
      'It lists each foreign customer\'s VAT number, the type of supply and the total value for the period. Without supplies to other EU countries none is filed.'
    ],
    example: 'A translator invoiced a German and an Austrian firm in March. By 25 April she files an EC Sales List with both VAT numbers and the March totals.',
    match: ['EC Sales Lists?', 'recapitulative statements?']
  },
  'vat-return': {
    term: 'VAT return',
    aka: 'přiznání k DPH (CZ), daňové priznanie k DPH (SK)',
    definition:
      'A VAT return is the form in which a VAT payer reports, for each tax period, the output VAT and the deductible input VAT, and works out the tax to pay or the excess deduction.',
    explanation: [
      'Czech Republic: who files is set by § 101 of the VAT Act; the return is filed electronically by the 25th day after the tax period, and a deadline falling on a weekend or holiday moves to the next working day. Slovakia: § 78, filed within 25 days after the period, with the tax paid in the same time.',
      'With the return the payer files the control statement and, where it applies, the EC Sales List.'
    ],
    example: 'A monthly payer files the September return by 25 October. Output VAT of CZK 42,000 minus deductions of CZK 15,000 gives CZK 27,000 to pay.',
    match: ['VAT returns?']
  },
  'tax-period': {
    term: 'VAT tax period',
    definition:
      'The tax period is the stretch of time a VAT return covers: a calendar month or, under conditions the law sets, a calendar quarter.',
    explanation: [
      'Czech Republic: the month is the default (§ 99 of the VAT Act); a payer may switch to quarters under § 99a, among other conditions with turnover of at most CZK 15,000,000 in the previous year, and must notify the tax office by the end of January. Legal persons still file the control statement monthly.',
      'Slovakia: the tax period is set by § 77 of the VAT Act. The month is the default and a payer meeting its conditions may choose quarters.'
    ],
    example: 'A quarterly payer files the July to September return by 25 October. A monthly payer files one return per month.',
    match: ['tax periods?']
  },
  oss: {
    term: 'OSS',
    aka: 'One Stop Shop',
    definition:
      'OSS is a scheme that lets a business declare the VAT on sales of goods and services to consumers in other EU countries in a single return in its own country, instead of registering in each country.',
    explanation: [
      'Distance sales to consumers in another EU country are taxed at the customer\'s country rate once the EU-wide threshold is exceeded. OSS lets the seller declare and pay that VAT through its home tax office: § 110a to 110l of the Czech VAT Act, § 68 to 68b of the Slovak one.',
      'Joining is voluntary and electronic. The OSS return is quarterly and shows turnover and VAT separately for each country.'
    ],
    example: 'An online shop in Brno sells to consumers in Slovakia and Poland. Above the threshold it charges Slovak and Polish VAT and declares both in one quarterly OSS return.',
    match: ['\\bOSS\\b', 'One Stop Shop']
  },
  'e-invoice': {
    term: 'Electronic invoice',
    aka: 'e-invoice',
    definition:
      'An electronic invoice is an invoice issued and delivered electronically, as a PDF or as a structured file (ISDOC, Peppol UBL). A structured invoice can be read by accounting software without retyping.',
    explanation: [
      'Both VAT Acts treat an electronic invoice as equal to paper and today allow it with the customer\'s consent (§ 26(3) of the Czech Act, § 71(1) of the Slovak one). Authenticity of origin, integrity of content and legibility must be ensured.',
      'In Slovakia, from 1 January 2027 domestic invoices between businesses must be structured e-invoices delivered through certified delivery services, in practice the Peppol network. In the Czech Republic structured invoices remain voluntary.'
    ],
    example: 'A supplier emails a PDF invoice with an ISDOC file attached. The customer\'s accountant imports the file and the data fill in on their own.',
    match: ['e-invoices?', 'electronic invoices?']
  },
  peppol: {
    term: 'Peppol',
    definition:
      'Peppol is an international network and set of standards for exchanging e-invoices and other business documents between companies and public bodies. An invoice travels as a structured Peppol BIS (UBL) file through certified access points.',
    explanation: [
      'Sender and receiver join through their access point provider and are found by an identifier, usually a VAT number or company ID. Peppol BIS Billing 3.0 is based on the European standard EN 16931.',
      'Slovakia: from 1 January 2027 domestic B2B invoices go through certified delivery services, in practice the Peppol network. Czech Republic: Peppol is voluntary.'
    ],
    example: 'A Czech firm invoices a Belgian customer. Instead of a PDF it sends the invoice over Peppol and it appears straight in the customer\'s accounting system.',
    match: ['\\bPeppol\\b']
  },
  'variable-symbol': {
    term: 'Variable symbol',
    aka: 'variabilní symbol, VS',
    definition:
      'The variable symbol is a number of up to ten digits the payer enters with a bank transfer so the recipient knows what is being paid. On an invoice it is usually the invoice number.',
    explanation: [
      'It is a convention of Czech and Slovak domestic payments; no tax law requires it on an invoice. Without it, matching incoming payments is hard.',
      'QR payment codes carry the variable symbol so the customer does not retype it. In SEPA payments it travels in the payment reference.'
    ],
    example: 'Invoice 2026015 shows variable symbol 2026015. The customer enters it with the payment and the supplier\'s software matches the payment to the invoice.',
    match: ['variable symbols?']
  },
  'due-date': {
    term: 'Due date',
    aka: 'datum splatnosti (CZ), dátum splatnosti (SK)',
    definition:
      'The due date is the day by which the customer must pay the invoice. After it the customer is in default and the supplier may claim late-payment interest.',
    explanation: [
      'Czech Republic: without an agreed term the creditor may ask for payment at once and the debtor must pay without undue delay (§ 1958(2) of the Civil Code). Between businesses a term over 60 days applies only if expressly agreed and not grossly unfair to the creditor (§ 1963).',
      'Slovakia: between businesses an agreed term may not exceed 60 days from receipt of the invoice or from performance, whichever is later (§ 340a of the Commercial Code).',
      'Payment is on time when the money is credited to the creditor\'s account by the due date, not when the debtor sends it.'
    ],
    example: 'An invoice issued on 1 June with 14 days to pay is due on 15 June. If the money arrives on 18 June, the customer is three days late.',
    match: ['due dates?']
  },
  'late-payment-interest': {
    term: 'Late-payment interest',
    aka: 'úrok z prodlení (CZ), úrok z omeškania (SK)',
    definition:
      'Late-payment interest is what a debtor pays on top of the invoice for each day it is overdue. When the parties agreed no rate, the rate is set by government regulation.',
    explanation: [
      'The claim rests on § 1970 of the Czech Civil Code and, for commercial obligations, § 369 of the Slovak Commercial Code.',
      'The creditor does not have to claim it; if it wants to, it states the amount in a reminder or a separate invoice. Check the current regulation before calculating.'
    ],
    example: 'A customer pays 20 days late. The supplier sends a reminder stating the interest for those 20 days on the amount owed.',
    match: ['late[- ]payment interest']
  },
  iban: {
    term: 'IBAN',
    aka: 'International Bank Account Number',
    definition:
      'IBAN is the international format of a bank account number, starting with a country code and two check digits. Czech and Slovak IBANs have 24 characters: country code, check digits, bank code, account prefix and account number.',
    explanation: [
      'IBAN is used for euro SEPA payments, payments from abroad and QR payments; in Slovakia also for every domestic payment. The check digits catch most typos before the money leaves.',
      'Czech invoices usually show both the domestic account number and the IBAN, Slovak invoices the IBAN.'
    ],
    example: 'The Czech account 19-2000145399/0800 has the IBAN CZ65 0800 0000 1920 0014 5399. The spaces are only for readability.',
    match: ['\\bIBANs?\\b']
  },
  'qr-payment': {
    term: 'QR payment',
    aka: 'QR Platba (SPAYD), PAY by square',
    definition:
      'A QR payment is a QR code on an invoice holding the account number, amount, variable symbol and other payment details. The customer scans it in a banking app and types nothing.',
    explanation: [
      'Czech banks use the QR Platba (SPAYD) format of the Czech Banking Association, Slovak banks the PAY by square format.',
      'The code is not a required part of an invoice, but it speeds up payment and prevents typos in the account number and variable symbol.'
    ],
    example: 'An invoice for CZK 8,470 has a QR code in the corner. The customer scans it, the bank fills in the account, amount and variable symbol, and he just confirms.',
    match: ['QR payments?', 'PAY by square', 'SPAYD']
  },
  vies: {
    term: 'VIES',
    aka: 'VAT Information Exchange System',
    definition:
      'VIES is the European Commission\'s system for checking whether a business in another EU country has a valid VAT number for intra-EU trade. EU countries also exchange EC Sales List data through it.',
    explanation: [
      'Before invoicing a business in another EU country under reverse charge, check its VAT number in VIES. An invalid number means the customer is not registered for VAT.',
      'Saving the dated result is good evidence that the supplier acted in good faith.'
    ],
    example: 'A designer invoices an Austrian agency. VIES confirms its VAT number ATU12345678 as valid, so the designer invoices without Czech VAT.',
    match: ['\\bVIES\\b']
  },
  'exchange-rate': {
    term: 'Exchange rate for VAT',
    definition:
      'On an invoice in a foreign currency the tax base and VAT are converted at the rate the VAT Act sets. Czech payers use the Czech National Bank rate for the day the tax duty arises; Slovak payers the ECB or National Bank of Slovakia rate for the day before.',
    explanation: [
      'Czech Republic: § 4(8) of the VAT Act; instead of the ČNB rate the last rate published by the European Central Bank may be used. Slovakia: § 26(1), the reference rate valid on the day before the tax duty arises.',
      'The invoice may be in euros or any currency, but the VAT must also be shown in the national currency.'
    ],
    example: 'A Czech payer invoices €1,000 net with a taxable supply date of 10 March and a ČNB rate of CZK 25.00/€ for that day. The tax base is CZK 25,000 and 21 % VAT is CZK 5,250.',
    match: ['exchange rates?']
  },
  dic: {
    term: 'DIČ (tax ID)',
    aka: 'daňové identifikační číslo',
    definition:
      'DIČ is the tax identification number the tax office assigns. In the Czech Republic it is CZ followed by 8 to 10 digits and serves as the VAT number; in Slovakia it is 10 digits and the VAT number is a separate IČ DPH.',
    explanation: [
      'Having a DIČ does not make a business a VAT payer: income-tax registrants have one too.',
      'A Czech VAT payer shows its own DIČ on tax documents and, for supplies to another payer, the customer\'s too. A Slovak payer shows the IČ DPH. Validity for EU trade is checked in VIES.'
    ],
    example: 'A Czech company with IČO 12345678 has DIČ CZ12345678. A Slovak sole trader with DIČ 1023456789 gets IČ DPH SK1023456789 on registering for VAT.',
    match: ['\\bDIČ\\b']
  },
  ico: {
    term: 'IČO (company ID)',
    aka: 'identifikační číslo osoby (CZ), identifikačné číslo organizácie (SK)',
    definition:
      'IČO is the eight-digit identification number of a business or other organisation in the Czech and Slovak state registers. It appears on invoices and all business documents.',
    explanation: [
      'It is assigned when the company is formed or the business starts and never changes. It can be looked up in the Czech ARES register or the Slovak register of legal entities.',
      'IČO identifies; it is not a tax number. Taxes use DIČ and, in Slovakia, IČ DPH.'
    ],
    example: 'In invoicing software, entering the customer\'s IČO fills in the name and address from the register.',
    match: ['\\bIČO\\b']
  },
  'flat-rate-expenses': {
    term: 'Flat-rate expenses',
    aka: 'výdajový paušál (CZ), paušálne výdavky (SK)',
    definition:
      'Flat-rate expenses let a self-employed person deduct a set percentage of income instead of actual costs. In Slovakia it is 60 % of income, at most €20,000 a year; in the Czech Republic the percentage depends on the type of activity.',
    explanation: [
      'Czech Republic: § 7(7) of the Income Tax Act sets the percentages and the cap. Slovakia: § 6(10) of the Income Tax Act.',
      'It saves keeping expense records but can come out worse than actual costs for a business with high costs.'
    ],
    example: 'A Slovak developer with €30,000 income claims 60 %, i.e. €18,000. With €40,000 income it would be €24,000, so he claims only the €20,000 cap.',
    match: ['flat-rate expenses']
  },

  // Czech terms.
  'taxable-supply-date': {
    term: 'DUZP (taxable supply date)',
    aka: 'datum uskutečnění zdanitelného plnění',
    definition:
      'DUZP is the day a Czech VAT payer supplied the goods or service, or received payment if that came first. On this day the duty to declare VAT arises, and it decides which tax period the supply belongs to.',
    explanation: [
      'The duty to declare VAT on the supply date, or on an earlier payment, is set by § 20a of the Czech VAT Act. § 21 says when a supply takes place: for goods usually on delivery, for services on the day they are provided or the tax document is issued, whichever is earlier.',
      'The tax document must be issued within 15 days of the day the duty arose (§ 28(8)). The DUZP is shown on it and need not match the issue date.'
    ],
    example: 'A plumber finishes work on 28 March and issues the invoice on 2 April. The DUZP is 28 March, so the VAT goes into the March return.',
    match: ['\\bDUZP\\b', 'taxable supply date']
  },
  'tax-document': {
    term: 'Tax document (daňový doklad)',
    definition:
      'A tax document is the document a Czech VAT payer issues for a taxable supply; the customer needs it to deduct VAT. Its particulars are set by § 29 of the Czech VAT Act.',
    explanation: [
      'Types and issuing are set by § 26 and § 28, content by § 29. They include the regular, simplified and corrective tax document.',
      'Required details include the registration number, both parties\' DIČ, the description, the issue date, the DUZP, the tax base, the rate and the VAT. An invoice that has them is a tax document.'
    ],
    example: 'A payer\'s invoice titled "Faktura – daňový doklad" with a number, DUZP, both DIČ and a VAT summary by rate is a tax document.',
    match: ['tax documents?']
  },
  'simplified-tax-document': {
    term: 'Simplified tax document',
    aka: 'zjednodušený daňový doklad',
    definition:
      'A simplified tax document is a Czech tax document with fewer details, allowed when the total does not exceed CZK 10,000. A shop receipt is the typical example.',
    explanation: [
      'It is governed by § 30 of the Czech VAT Act. It need not identify the customer, and the price including VAT with the rate can replace the tax base and VAT amount.',
      'It cannot be used, for example, under reverse charge or for a supply of goods to another EU country.'
    ],
    example: 'A café that is a VAT payer gives a receipt for coffee and cake for CZK 180 with its DIČ, the date, the price including VAT and the rate.',
    match: ['simplified tax documents?']
  },
  'control-statement': {
    term: 'Control statement (kontrolní hlášení)',
    aka: 'KH',
    definition:
      'The control statement is a Czech VAT report listing issued and received tax documents, which the tax administration uses to match supplies between suppliers and customers. It is filed electronically with the return or monthly.',
    explanation: [
      'It is required by § 101c of the Czech VAT Act, with deadlines in § 101e: individuals file for the same period as the return, legal persons always monthly, by the 25th day after the period.',
      'Documents over CZK 10,000 including VAT are listed one by one with the other party\'s DIČ, smaller ones in total. Late or missing filing is penalised.'
    ],
    example: 'In October a payer issued a CZK 60,000 invoice to another payer and received a CZK 24,200 rent invoice. Both go one by one into the October control statement, filed by 25 November.',
    match: ['control statements?']
  },
  'identified-person': {
    term: 'Identified person',
    aka: 'identifikovaná osoba',
    definition:
      'An identified person is a Czech business that is not a VAT payer but is registered for VAT because of services or goods from other EU countries. It must declare and pay VAT on those purchases but cannot deduct it.',
    explanation: [
      'When a business becomes one is set by § 6g to 6l of the Czech VAT Act. Typically a non-payer buys a service from a business in another EU country (advertising, software, platform services) or provides a service to one.',
      'It files a VAT return only for months with such a supply, and an EC Sales List if it provided the service. Its domestic invoices stay without VAT.'
    ],
    example: 'A non-payer buys CZK 2,000 of advertising from an Irish company. It becomes an identified person and declares and pays 21 % VAT of CZK 420.',
    match: ['identified persons?']
  },
  'flat-tax': {
    term: 'Flat tax (paušální daň)',
    aka: 'paušální režim',
    definition:
      'The Czech flat tax is a single monthly payment that covers a self-employed person\'s income tax, social security and health insurance. Those in the scheme file no tax return or insurance statements.',
    explanation: [
      'It is governed by § 2a and § 7a of the Czech Income Tax Act. It is open to self-employed people who are not VAT payers and whose income stays within the legal limit; the payment depends on the income band and type of activity.',
      'Entry is by notice to the tax office. The band amounts change every year; the flat tax calculator shows the current ones.'
    ],
    example: 'A designer who is not a VAT payer and whose income is within the first band pays one fixed amount to the tax office every month and files no return after the year.',
    match: ['flat tax']
  },
  isdoc: {
    term: 'ISDOC',
    definition:
      'ISDOC is the Czech XML format for electronic invoices, read by most Czech accounting software. It is used between companies and in public administration.',
    explanation: [
      'It was created by an association of accounting software vendors. The file is sent on its own or embedded with the PDF (ISDOCX), so people and software can both read the invoice.',
      'Unlike Peppol, ISDOC is a data format, not a network. The law does not prescribe it.'
    ],
    example: 'A customer asks for invoices in ISDOC. The supplier attaches the file to the email with the PDF and the accountant imports it in one click.',
    match: ['\\bISDOC\\b']
  },
  'unreliable-payer': {
    term: 'Unreliable payer',
    aka: 'nespolehlivý plátce',
    definition:
      'An unreliable payer is a Czech VAT payer the tax office has flagged for serious breaches of its VAT duties. Whoever pays it may become liable for its unpaid VAT.',
    explanation: [
      'The flag is governed by § 106a of the Czech VAT Act, the customer\'s liability by § 109. The list of unreliable payers and published bank accounts is public in the VAT register.',
      'Liability can also arise from paying to an account the payer has not published, above the legal limit. Check the supplier in the register before a larger payment.'
    ],
    example: 'Before paying a CZK 150,000 invoice a company checks the supplier in the register, finds it is unreliable and pays the VAT directly to the supplier\'s tax office.',
    match: ['unreliable payers?']
  },
  'self-employed': {
    term: 'OSVČ (self-employed person)',
    aka: 'osoba samostatně výdělečně činná',
    definition:
      'OSVČ is the Czech term for a self-employed individual, typically with a trade licence. They pay their own income tax and advances on social security and health insurance.',
    explanation: [
      'Business income is taxed under § 7 of the Czech Income Tax Act. Expenses can be actual or flat-rate, or the person can choose the flat tax.',
      'The minimum insurance advances are set by law each year, and after the year the OSVČ files statements for social security and the health insurer.'
    ],
    example: 'An accountant working on a trade licence is an OSVČ. She pays insurance advances every month and files a tax return and statements after the year.',
    match: ['\\bOSVČ\\b']
  },
  'data-box': {
    term: 'Data box (datová schránka)',
    aka: 'ISDS',
    definition:
      'A data box is the Czech electronic mailbox for official documents between the state, companies and citizens. A message delivered there has the same effect as registered mail.',
    explanation: [
      'Companies in the commercial register and self-employed individuals have one set up by law. Whoever has one files tax returns and reports electronically.',
      'A VAT return or control statement can be sent through the data box as an XML file or through the MOJE daně tax portal.'
    ],
    example: 'A payer exports the VAT return as XML from the invoicing software and sends it to the tax office through its data box.',
    match: ['data box(?:es)?']
  },

  // Slovak terms.
  'delivery-date': {
    term: 'Delivery date (dátum dodania)',
    definition:
      'The delivery date is the day a Slovak VAT payer delivered goods or provided a service. The tax duty arises on that day, and it decides which tax period the supply belongs to.',
    explanation: [
      'When the tax duty arises is set by § 19 of the Slovak VAT Act. If the payer receives payment before the supply, the duty arises on the day of payment.',
      'The invoice must be issued within 15 days of the supply or payment (§ 73). The delivery date is shown on it if it differs from the issue date.'
    ],
    example: 'A plumber finishes work on 28 March and issues the invoice on 2 April. The delivery date is 28 March, so the VAT goes into the March return.'
  },
  'ic-dph': {
    term: 'IČ DPH (Slovak VAT number)',
    aka: 'identifikačné číslo pre daň z pridanej hodnoty',
    definition:
      'IČ DPH is the Slovak VAT identification number, given to VAT payers and to persons registered under § 7a. It is SK followed by the ten digits of the DIČ.',
    explanation: [
      'The tax office assigns it on VAT registration (§ 4 and § 7a of the Slovak VAT Act). It appears on invoices and is used for intra-EU trade, where the customer checks it in VIES.',
      'DIČ and IČ DPH are not the same: every taxpayer has a DIČ, only VAT-registered ones have an IČ DPH.'
    ],
    example: 'A company with DIČ 2020123456 registers for VAT and gets IČ DPH SK2020123456, which it now shows on its invoices.',
    match: ['IČ DPH']
  },
  'sk-control-statement': {
    term: 'Control statement (kontrolný výkaz)',
    aka: 'KV DPH',
    definition:
      'The kontrolný výkaz is the Slovak VAT report listing issued and received invoices, which the tax administration uses to match supplies between suppliers and customers. It is filed electronically for each tax period.',
    explanation: [
      'It is required by § 78a of the Slovak VAT Act and filed for the same period as the VAT return, within 25 days after it ends.',
      'Invoices are listed with the other party\'s IČ DPH; small cash-register receipts in total. Late or missing filing is penalised.'
    ],
    example: 'In October a payer issued an invoice to another payer and received a rent invoice. Both go into the October control statement, filed by 25 November.',
    match: ['kontrolný výkaz']
  },
  'section-7a-registration': {
    term: 'Registration under § 7a',
    aka: 'osoba registrovaná pre DPH podľa § 7a',
    definition:
      'Registration under § 7a of the Slovak VAT Act is for a business that is not a VAT payer but receives services from, or provides services to, businesses in other EU countries. It gets an IČ DPH, declares and pays VAT on services received, but cannot deduct it.',
    explanation: [
      'Registration comes before the first such transaction. Typically a non-payer buys advertising, software or platform services from abroad, or provides a service to a business in another EU country.',
      'It files a VAT return only for periods with such a service, and an EC Sales List if it provided one. Its domestic invoices stay without VAT.'
    ],
    example: 'A non-payer buys €100 of advertising from an Irish company. Registered under § 7a, it declares and pays 23 % VAT of €23.',
    match: ['§\\s?7a']
  },
  'sk-e-invoicing-2027': {
    term: 'Slovak e-invoicing from 2027',
    aka: 'povinná elektronická fakturácia',
    definition:
      'From 1 January 2027, domestic invoices between businesses in Slovakia must be structured electronic invoices delivered through certified delivery services, in practice the Peppol network. A PDF sent by email no longer counts.',
    explanation: [
      'The duty was added to § 85o of the Slovak VAT Act by Act No. 385/2025. The invoice must follow the European standard EN 16931, in practice Peppol BIS Billing 3.0 (UBL 2.1), be issued within 15 days and be delivered through a certified delivery service under § 76a. Supplier and customer each report the invoice data to the Financial Directorate within 5 days.',
      'The customer\'s consent to e-invoicing is no longer needed. The duty covers domestic invoices between businesses; invoices to consumers do not change.'
    ],
    example: 'An accountant invoices a Slovak company her monthly fee. From January 2027 she sends the invoice not as a PDF but through a delivery service, and it appears straight in the client\'s accounting software.'
  },
  szco: {
    term: 'SZČO (Slovak self-employed person)',
    aka: 'samostatne zárobkovo činná osoba',
    definition:
      'SZČO is the Slovak term for a self-employed individual, typically with a trade licence. They pay their own income tax and social security and health insurance contributions.',
    explanation: [
      'Business income is taxed under § 6 of the Slovak Income Tax Act. Expenses can be actual or flat-rate.',
      'Social insurance applies once the previous year\'s income exceeds the legal threshold; health insurance applies from the start. The calculator shows the contributions.'
    ],
    example: 'A designer with a trade licence is an SZČO. After the year he files a tax return, claims flat-rate expenses and pays contributions based on the result.',
    match: ['\\bSZČO\\b']
  }
};
