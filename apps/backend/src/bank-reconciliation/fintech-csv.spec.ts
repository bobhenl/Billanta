import { describe, expect, it } from "vitest";
import { parseBankStatementCsv } from "./csv-parser";
import { splitDuplicates } from "./dedupe";

// Headers follow the providers' documented CSV exports; the rows are made up.
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const WISE_HISTORY_HEADER =
  '"ID","Status","Direction","Created on","Finished on","Source fee amount","Source fee currency",' +
  '"Target fee amount","Target fee currency","Source name","Source amount (after fees)","Source currency",' +
  '"Target name","Target amount (after fees)","Target currency","Exchange rate","Reference","Batch",' +
  '"Created by","Category","Note"';

const wiseHistory = [
  WISE_HISTORY_HEADER,
  '"TRANSFER-1001","COMPLETED","IN","2026-09-30 23:30:12","2026-09-30 23:30:15","","","0.40","EUR","Musterfirma GmbH","1209.60","EUR","Testovací s.r.o.","1209.60","EUR","1.0","2026001","","","",""',
  '"TRANSFER-1002","COMPLETED","OUT","2026-10-02 08:00:00","2026-10-02 08:05:00","1.20","EUR","","","Testovací s.r.o.","500.00","EUR","Dodavatel a.s.","12100.00","CZK","24.2","Faktura FV-17","","Jana Testová","",""',
  '"BALANCE-1003","COMPLETED","NEUTRAL","2026-10-03 09:00:00","2026-10-03 09:00:01","2.10","EUR","","","Testovací s.r.o.","997.90","EUR","Testovací s.r.o.","24150.00","CZK","24.2","","","","",""',
  '"TRANSFER-1004","CANCELLED","IN","2026-10-04 09:00:00","","","","","","Někdo","50.00","EUR","Testovací s.r.o.","50.00","EUR","1.0","","","","",""',
].join("\n");

const WISE_STATEMENT_HEADER =
  '"TransferWise ID","Date","Date Time","Amount","Currency","Description","Payment Reference","Running Balance",' +
  '"Exchange From","Exchange To","Exchange Rate","Payer Name","Payee Name","Payee Account Number","Merchant",' +
  '"Card Last Four Digits","Card Holder Full Name","Attachment","Note","Total fees","Exchange To Amount",' +
  '"Transaction Type","Transaction Details Type"';

const wiseStatement = [
  WISE_STATEMENT_HEADER,
  '"TRANSFER-2001","30-09-2026","30-09-2026 22:15:00.000","1210.00","EUR","Received money from Musterfirma GmbH with reference 2026002","2026002","2210.00","","","","Musterfirma GmbH","","","","","","","","0.00","","CREDIT","MONEY_ADDED"',
  '"BALANCE-2002","01-10-2026","01-10-2026 09:00:00.000","-100.00","EUR","Converted 100.00 EUR to 2,420.00 CZK","","2110.00","EUR","CZK","24.2","","","","","","","","","0.00","2420.00","DEBIT","CONVERSION"',
  '"CARD-2003","02-10-2026","02-10-2026 10:00:00.000","-25.50","EUR","Card transaction of 25.00 EUR issued by Kavarna U Mostu","","2084.50","","","","","","","Kavárna U Mostu","1234","Jana Testová","","","0.50","","DEBIT","CARD"',
  '"TRANSFER-2004","03-10-2026","03-10-2026 12:00:00.000","99.00","EUR","Received money from Example LLC","","2183.50","","","","Example LLC","","","","","","","","1.00","","CREDIT","DEPOSIT"',
].join("\n");

const REVOLUT_BUSINESS_HEADER =
  '"Date started (UTC)","Date completed (UTC)","ID","Type","State","Description","Reference","Payer",' +
  '"Card number","Orig currency","Orig amount","Payment currency","Amount","Fee","Balance","Account",' +
  '"Beneficiary account number","Beneficiary sort code or routing number","Beneficiary IBAN","Beneficiary BIC"';

const revolutBusiness = [
  REVOLUT_BUSINESS_HEADER,
  '"2026-09-30T21:50:00.000Z","2026-09-30T22:10:00.000Z","6f1c2a10-0000-4000-8000-000000000001","TRANSFER","COMPLETED","Payment from Odběratel s.r.o.","VS 2026003","","","CZK","15000.00","CZK","15000.00","0.00","40000.00","CZK Main","","","",""',
  '"2026-10-02","2026-10-02","6f1c2a10-0000-4000-8000-000000000002","TRANSFER","COMPLETED","To Dodavatel a.s.","Faktura 55","Jana Testová","","CZK","-1200.00","CZK","-1200.00","5.00","38795.00","CZK Main","123456789/0100","","CZ6501000000000123456789",""',
  '"2026-10-03","","6f1c2a10-0000-4000-8000-000000000003","CARD_PAYMENT","REVERTED","Shop","","","4111********1111","CZK","-300.00","CZK","-300.00","0.00","","CZK Main","","","",""',
  '"2026-10-03","","6f1c2a10-0000-4000-8000-000000000004","CARD_PAYMENT","DECLINED","Shop","","","4111********1111","CZK","-90.00","CZK","-90.00","0.00","","CZK Main","","","",""',
  '"2026-10-04","2026-10-04","6f1c2a10-0000-4000-8000-000000000005","EXCHANGE","COMPLETED","Exchanged to EUR","","","","CZK","-2420.00","CZK","-2420.00","0.00","36375.00","CZK Main","","","",""',
  '"2026-10-05","","6f1c2a10-0000-4000-8000-000000000006","TRANSFER","PENDING","Payment from Pomalý klient","2026009","","","CZK","500.00","CZK","500.00","0.00","","CZK Main","","","",""',
].join("\n");

const revolutPersonal = [
  "Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance",
  "TRANSFER,Current,2026-09-30 21:00:00,2026-09-30 22:30:00,Payment from Jana Testova,250.00,0.00,EUR,COMPLETED,1250.00",
  "CARD_PAYMENT,Current,2026-10-01 10:00:00,2026-10-01 10:00:05,Lidl,-12.40,0.20,EUR,COMPLETED,1237.40",
  "CARD_PAYMENT,Current,2026-10-01 11:00:00,,Shop,-30.00,0.00,EUR,REVERTED,",
  "CARD_PAYMENT,Current,2026-10-01 12:00:00,,Shop,-31.00,0.00,EUR,DECLINED,",
  "EXCHANGE,Current,2026-10-02 08:00:00,2026-10-02 08:00:00,Exchanged to CZK,-100.00,0.00,EUR,COMPLETED,1137.40",
].join("\n");

const revolutLegacy = [
  "Completed Date ; Description ; Paid Out (EUR) ; Paid In (EUR) ; Exchange Out; Exchange In; Balance (EUR); Category; Notes",
  "15 Jan 2019 ; Payment from Jan Novak ;  ; 120.00 ; ; ; 520.00; transfers; ",
  "16 Jan 2019 ; To Dodavatel ; 1,200.00 ;  ; ; ; -680.00; transfers; ",
  "17 Jan 2019 ; Exchanged to CZK ; 50.00 ;  ; ; 1,210.00 CZK; -730.00; exchange; ",
].join("\n");

const stripeBalance = [
  "balance_transaction_id,created_utc,available_on_utc,currency,gross,fee,net,reporting_category,source_id,description," +
    "customer_facing_amount,customer_facing_currency,customer_id,customer_email,customer_name,customer_description," +
    "charge_id,payment_intent_id,invoice_id,invoice_number",
  "txn_1A,2026-09-30 23:30:00,2026-10-07 00:00:00,eur,1210.00,35.53,1174.47,charge,ch_1A,2026004,1210.00,eur,cus_1,ucetni@example.com,Musterfirma GmbH,,ch_1A,pi_1A,,",
  "txn_1B,2026-10-07 02:00:00,2026-10-07 02:00:00,eur,-1174.47,0.00,-1174.47,payout,po_1B,STRIPE PAYOUT,,,,,,,,,,",
].join("\n");

const stripeDashboardBalance = [
  "id,Type,Source,Amount,Fee,Net,Currency,Created (UTC),Available On (UTC),Description,Customer Facing Amount,Customer Facing Currency,Transfer,Transfer Date (UTC),Transfer Group",
  "txn_2A,charge,ch_2A,500.00,14.75,485.25,czk,2026-11-02 10:00,2026-11-09 00:00,Faktura 2026010,500.00,czk,,,",
  "txn_2B,refund,re_2B,-100.00,0.00,-100.00,czk,2026-11-03 10:00,2026-11-03 10:00,REFUND FOR CHARGE,,,,,",
].join("\n");

const stripePayments = [
  "id,Created (UTC),Amount,Amount Refunded,Currency,Captured,Converted Amount,Converted Amount Refunded,Converted Currency," +
    "Decline Reason,Description,Fee,Refunded date (UTC),Statement Descriptor,Status,Seller Message,Taxes On Fee,Card ID," +
    "Customer ID,Customer Description,Customer Email,Invoice ID,Transfer",
  "ch_1A,2026-09-30 23:30:00,1210.00,0.00,eur,true,1210.00,0.00,eur,,2026004,35.53,,TESTOVACI,Paid,Payment complete.,0.00,card_1,cus_1,Musterfirma GmbH,ucetni@example.com,,",
  "ch_3,2026-10-02 10:00:00,100.00,0.00,usd,true,2350.00,0.00,czk,,Faktura,72.00,,TESTOVACI,Paid,Payment complete.,0.00,card_3,cus_3,Example LLC,ap@example.com,,",
  "ch_4,2026-10-02 11:00:00,80.00,0.00,eur,false,80.00,0.00,eur,card_declined,,0.00,,TESTOVACI,Failed,Declined.,0.00,card_4,cus_4,,,,",
  "ch_5,2026-10-02 12:00:00,60.00,60.00,eur,true,60.00,60.00,eur,,,2.00,2026-10-03 10:00:00,TESTOVACI,Refunded,,0.00,card_5,cus_5,,,,",
  "ch_6,2026-10-02 13:00:00,70.00,0.00,eur,false,70.00,0.00,eur,,,0.00,,TESTOVACI,Paid,Uncaptured.,0.00,card_6,cus_6,,,,",
].join("\n");

describe("Wise CSV exports", () => {
  it("reads the transaction history: gross = after fees + fee, signed by direction, Prague day", () => {
    const rows = parseBankStatementCsv(wiseHistory);

    expect(rows).toEqual([
      {
        transactionDate: day("2026-10-01"),
        amount: "1210.00",
        currency: "EUR",
        variableSymbol: "2026001",
        counterpartyAccount: null,
        counterpartyName: "Musterfirma GmbH",
        message: "2026001",
        fee: "0.40",
        externalId: "wise:TRANSFER-1001:EUR",
      },
      {
        transactionDate: day("2026-10-02"),
        amount: "-501.20",
        currency: "EUR",
        variableSymbol: null,
        counterpartyAccount: null,
        counterpartyName: "Dodavatel a.s.",
        message: "Faktura FV-17",
        fee: "1.20",
        externalId: "wise:TRANSFER-1002:EUR",
      },
    ]);
  });

  it("reads the balance statement and drops conversions between own balances", () => {
    const rows = parseBankStatementCsv(wiseStatement);

    expect(rows.map((r) => [r.externalId, r.amount, r.fee, r.transactionDate.toISOString().slice(0, 10)])).toEqual([
      ["wise:TRANSFER-2001:EUR", "1210.00", null, "2026-10-01"],
      ["wise:CARD-2003:EUR", "-25.50", "0.50", "2026-10-02"],
      // A credit is net of Wise's fee, so the payer sent 100.00.
      ["wise:TRANSFER-2004:EUR", "100.00", "1.00", "2026-10-03"],
    ]);
    expect(rows[0]).toMatchObject({ variableSymbol: "2026002", counterpartyName: "Musterfirma GmbH", message: "2026002" });
    expect(rows[1].counterpartyName).toBe("Kavárna U Mostu");
  });

  it("uses the plain DD-MM-YYYY day when the statement has no Date Time column", () => {
    const csv = ['"TransferWise ID","Date","Amount","Currency","Description"', '"TRANSFER-9","31-10-2026","10.00","CZK","x"'].join("\n");

    expect(parseBankStatementCsv(csv)[0].transactionDate).toEqual(day("2026-10-31"));
  });

  it("gives a payment the same id in both Wise exports, so the second upload is a duplicate", () => {
    const fromHistory = parseBankStatementCsv(wiseHistory)[0];
    const stored = [{ ...fromHistory, id: "row-1", externalId: fromHistory.externalId ?? null }];
    const statement = [
      WISE_STATEMENT_HEADER,
      '"TRANSFER-1001","01-10-2026","30-09-2026 23:30:15.000","1209.60","EUR","Received money from Musterfirma GmbH","2026001","","","","","Musterfirma GmbH","","","","","","","","0.40","","CREDIT","MONEY_ADDED"',
    ].join("\n");

    const { fresh, duplicates } = splitDuplicates(parseBankStatementCsv(statement), stored);
    expect(fresh).toHaveLength(0);
    expect(duplicates).toBe(1);
  });
});

describe("Revolut CSV exports", () => {
  it("reads a Business statement: completed rows only, no exchanges, fee and payee account", () => {
    const rows = parseBankStatementCsv(revolutBusiness);

    expect(rows).toEqual([
      {
        // Completed 22:10 UTC on 30 September = 00:10 on 1 October in Prague.
        transactionDate: day("2026-10-01"),
        amount: "15000.00",
        currency: "CZK",
        variableSymbol: "2026003",
        counterpartyAccount: null,
        counterpartyName: "Odběratel s.r.o.",
        message: "VS 2026003",
        fee: null,
        externalId: "revolut:6f1c2a10-0000-4000-8000-000000000001:CZK",
      },
      {
        transactionDate: day("2026-10-02"),
        amount: "-1200.00",
        currency: "CZK",
        variableSymbol: null,
        counterpartyAccount: "CZ6501000000000123456789",
        counterpartyName: "Dodavatel a.s.",
        message: "Faktura 55",
        fee: "5.00",
        externalId: "revolut:6f1c2a10-0000-4000-8000-000000000002:CZK",
      },
    ]);
  });

  it("reads a personal statement, which has no id column", () => {
    const rows = parseBankStatementCsv(revolutPersonal);

    expect(rows.map((r) => [r.amount, r.fee, r.externalId, r.transactionDate.toISOString().slice(0, 10)])).toEqual([
      ["250.00", null, null, "2026-10-01"],
      ["-12.40", "0.20", null, "2026-10-01"],
    ]);
    expect(rows[0].counterpartyName).toBe("Jana Testova");
  });

  it("reads the older statement with Paid Out / Paid In columns and the currency in the header", () => {
    const rows = parseBankStatementCsv(revolutLegacy);

    expect(rows.map((r) => [r.amount, r.currency, r.counterpartyName, r.transactionDate.toISOString().slice(0, 10)])).toEqual([
      ["120.00", "EUR", "Jan Novak", "2019-01-15"],
      ["-1200.00", "EUR", "Dodavatel", "2019-01-16"],
    ]);
  });

  it("explains a file that holds no completed payment at all", () => {
    const csv = revolutPersonal.split("\n").filter((line, i) => i === 0 || line.includes("REVERTED")).join("\n");

    expect(() => parseBankStatementCsv(csv)).toThrowError(/no completed payments/i);
  });
});

describe("Stripe CSV exports", () => {
  it("reads the itemised balance report: gross amount, fee, charges keyed by the charge id", () => {
    const rows = parseBankStatementCsv(stripeBalance);

    expect(rows).toEqual([
      {
        transactionDate: day("2026-10-01"),
        amount: "1210.00",
        currency: "EUR",
        variableSymbol: "2026004",
        counterpartyAccount: "ucetni@example.com",
        counterpartyName: "Musterfirma GmbH",
        message: "2026004",
        fee: "35.53",
        externalId: "stripe:ch_1A",
      },
      {
        transactionDate: day("2026-10-07"),
        amount: "-1174.47",
        currency: "EUR",
        variableSymbol: null,
        counterpartyAccount: null,
        counterpartyName: null,
        message: "STRIPE PAYOUT",
        fee: null,
        externalId: "stripe:txn_1B",
      },
    ]);
  });

  it("reads the Dashboard balance export with Amount / Fee / Net", () => {
    const rows = parseBankStatementCsv(stripeDashboardBalance);

    expect(rows.map((r) => [r.externalId, r.amount, r.fee, r.currency])).toEqual([
      ["stripe:ch_2A", "500.00", "14.75", "CZK"],
      ["stripe:txn_2B", "-100.00", null, "CZK"],
    ]);
  });

  it("reads the Payments export: paid and captured only, fee only in the charge currency", () => {
    const rows = parseBankStatementCsv(stripePayments);

    expect(rows.map((r) => [r.externalId, r.amount, r.currency, r.fee])).toEqual([
      ["stripe:ch_1A", "1210.00", "EUR", "35.53"],
      // The 72.00 fee is in CZK, the settlement currency, not in USD.
      ["stripe:ch_3", "100.00", "USD", null],
    ]);
    expect(rows[0]).toMatchObject({
      transactionDate: day("2026-10-01"),
      counterpartyName: "Musterfirma GmbH",
      counterpartyAccount: "ucetni@example.com",
    });
  });

  it("keys a charge the same in the Payments export and the balance report", () => {
    const [balanceCharge] = parseBankStatementCsv(stripeBalance);
    const [payment] = parseBankStatementCsv(stripePayments);

    expect(payment.externalId).toBe(balanceCharge.externalId);
  });
});

describe("fintech CSV row errors", () => {
  it("reports a bad amount with its line number instead of importing part of the file", () => {
    const csv = revolutPersonal.replace("250.00,0.00", "abc,0.00");

    try {
      parseBankStatementCsv(csv);
      expect.fail("expected parseBankStatementCsv to throw");
    } catch (err: unknown) {
      const response = (err as { getResponse: () => { errors: string[] } }).getResponse();
      expect(response.errors).toEqual(['Line 2: invalid amount "abc"']);
    }
  });
});
