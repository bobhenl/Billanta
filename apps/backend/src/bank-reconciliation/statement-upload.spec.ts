import { BadRequestException } from "@nestjs/common";
import type { BankStatementEntry } from "@faktur/cz-compliance";
import { describe, expect, it } from "vitest";
import { hasStatementExtension, parseUploadedStatement, statementToRows } from "./statement-upload";

function entry(overrides: Partial<BankStatementEntry> = {}): BankStatementEntry {
  return {
    bookingDate: "2026-09-30",
    amount: "1210.00",
    direction: "credit",
    currency: "CZK",
    variableSymbol: "2026001",
    constantSymbol: null,
    specificSymbol: null,
    counterpartyAccount: "19-123457/0800",
    counterpartyName: "Odběratel s.r.o.",
    message: "Faktura 2026001",
    bankReference: "REF-1",
    ...overrides,
  };
}

const camt = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
<Acct><Id><IBAN>CZ6508000000192000145399</IBAN></Id></Acct>
<Ntry><NtryRef>N1</NtryRef><Amt Ccy="CZK">500.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts>
<BookgDt><Dt>2026-09-30</Dt></BookgDt><AcctSvcrRef>A1</AcctSvcrRef>
<NtryDtls><TxDtls><RmtInf><Strd><CdtrRefInf><Ref>2026005</Ref></CdtrRefInf></Strd></RmtInf></TxDtls></NtryDtls></Ntry>
<Ntry><NtryRef>N2</NtryRef><Amt Ccy="CZK">80.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts>
<BookgDt><Dt>2026-09-30</Dt></BookgDt><AcctSvcrRef>A2</AcctSvcrRef></Ntry>
</Stmt></BkToCstmrStmt></Document>`;

describe("statementToRows", () => {
  it("keeps incoming payments only, as UTC days with an id namespaced by format and account", () => {
    const rows = statementToRows({
      format: "gpc",
      accountNumber: "19-2000145399/0800",
      entries: [entry(), entry({ direction: "debit", bankReference: "REF-2" })],
    });
    expect(rows).toEqual([
      {
        transactionDate: new Date(Date.UTC(2026, 8, 30)),
        amount: "1210.00",
        currency: "CZK",
        variableSymbol: "2026001",
        counterpartyAccount: "19-123457/0800",
        counterpartyName: "Odběratel s.r.o.",
        message: "Faktura 2026001",
        externalId: "gpc:19-2000145399/0800:REF-1",
      },
    ]);
  });

  it("leaves the id empty when the file has none, so the fingerprint decides", () => {
    const [row] = statementToRows({ format: "camt053", accountNumber: null, entries: [entry({ bankReference: null })] });
    expect(row!.externalId).toBeNull();
  });

  it("caps the id at the column length", () => {
    const [row] = statementToRows({ format: "camt053", accountNumber: "x", entries: [entry({ bankReference: "r".repeat(400) })] });
    expect(row!.externalId).toHaveLength(300);
  });
});

describe("parseUploadedStatement", () => {
  it("parses a camt.053 file", () => {
    const { source, rows } = parseUploadedStatement("vypis.xml", Buffer.from(camt, "utf8"));
    expect(source).toBe("camt053");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: "500.00", variableSymbol: "2026005" });
  });

  it("keeps CSV on the existing parser", () => {
    const csv = "datum;castka;mena;vs;protiucet;nazev protiuctu\n30.09.2026;1210,00;CZK;2026001;19-123457/0800;Odběratel\n";
    const { source, rows } = parseUploadedStatement("vypis.csv", Buffer.from(csv, "utf8"));
    expect(source).toBe("csv");
    expect(rows[0]).toMatchObject({ amount: "1210.00", externalId: null });
  });

  it("answers 400 with stable codes for an unknown or broken file", () => {
    expect(() => parseUploadedStatement("vypis.pdf", Buffer.from("%PDF-1.7"))).toThrow(BadRequestException);
    try {
      parseUploadedStatement("vypis.xml", Buffer.from("<Document><BkToCstmrStmt>", "utf8"));
      expect.unreachable();
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({ message: "bank_statement_invalid" });
    }
  });

  it("knows the accepted extensions", () => {
    expect(["a.CSV", "a.xml", "a.gpc", "a.ABO"].every(hasStatementExtension)).toBe(true);
    expect(hasStatementExtension("a.pdf")).toBe(false);
  });
});
