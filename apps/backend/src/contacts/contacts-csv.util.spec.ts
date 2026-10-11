import { describe, expect, it } from "vitest";
import { contactsToCsv, decodeCsvBuffer, mapContactRows, parseCsv } from "./contacts-csv.util";

describe("parseCsv", () => {
  it("detects the delimiter and strips the BOM", () => {
    expect(parseCsv("﻿a;b\r\n1;2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("handles quotes, doubled quotes and newlines inside quotes", () => {
    expect(parseCsv('name;note\n"Alfa; s.r.o.";"řekl ""ahoj""\nnový řádek"')).toEqual([
      ["name", "note"],
      ["Alfa; s.r.o.", 'řekl "ahoj"\nnový řádek'],
    ]);
  });

  it("drops blank lines", () => {
    expect(parseCsv("a;b\n\n1;2\n;\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("mapContactRows", () => {
  it("maps faktorio's export headers", () => {
    const rows = parseCsv("name,registration_no,vat_no,street,street2,city,zip,country,main_email\nAlfa s.r.o.,27074358,CZ27074358,Hlavní 1,budova B,Praha,110 00,CZ,a@alfa.cz");
    expect(mapContactRows(rows)).toEqual({
      contacts: [
        {
          line: 2,
          contact: {
            legalName: "Alfa s.r.o.",
            ico: "27074358",
            dic: "CZ27074358",
            email: "a@alfa.cz",
            addressStreet: "Hlavní 1, budova B",
            addressCity: "Praha",
            addressPostalCode: "110 00",
            addressCountry: "CZ",
            internalNote: null,
          },
        },
      ],
      skipped: [],
    });
  });

  it("maps Czech headers regardless of case and diacritics, normalising values", () => {
    const { contacts } = mapContactRows(parseCsv("NAZEV;ič;Dič;e-mail;Země\nBeta;123 456;sk 2020;b@beta.sk, druhy@beta.sk;Slovensko"));
    expect(contacts[0].contact).toMatchObject({ legalName: "Beta", ico: "00123456", dic: "SK2020", email: "b@beta.sk", addressCountry: "SK" });
  });

  it("reports invalid rows with their file line instead of failing", () => {
    const { contacts, skipped } = mapContactRows(parseCsv("Název;IČO;E-mail;Země\n;1;;\nA;12x;;\nB;;nope;\nC;;;Atlantida\nD;;;"));
    expect(skipped).toEqual([
      { line: 2, reason: "missing_name", name: "" },
      { line: 3, reason: "invalid_ico", name: "A" },
      { line: 4, reason: "invalid_email", name: "B" },
      { line: 5, reason: "invalid_country", name: "C" },
    ]);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ line: 6, contact: { legalName: "D", addressCountry: "CZ", ico: null } });
  });

  it("rejects a file without a name column", () => {
    expect(() => mapContactRows(parseCsv("datum;castka\n1.1.;100"))).toThrow("unknown_columns");
  });
});

describe("contactsToCsv", () => {
  it("round-trips through the importer", () => {
    const csv = contactsToCsv([
      {
        legalName: 'Gama; "nejlepší"',
        ico: "27074358",
        dic: null,
        email: "g@gama.cz",
        addressStreet: "Dlouhá 5",
        addressCity: "Brno",
        addressPostalCode: "60200",
        addressCountry: "CZ",
        isVatPayer: true,
        internalNote: "Platí pozdě; volat;\npaní Nová",
      },
    ]);
    expect(csv.startsWith("﻿Název;IČO;")).toBe(true);
    const { contacts } = mapContactRows(parseCsv(csv));
    expect(contacts[0].contact).toEqual({
      legalName: 'Gama; "nejlepší"',
      ico: "27074358",
      dic: null,
      email: "g@gama.cz",
      addressStreet: "Dlouhá 5",
      addressCity: "Brno",
      addressPostalCode: "60200",
      addressCountry: "CZ",
      internalNote: "Platí pozdě; volat;\npaní Nová",
    });
  });
});

describe("decodeCsvBuffer", () => {
  it("reads UTF-8 and falls back to windows-1250", () => {
    expect(decodeCsvBuffer(Buffer.from("Název", "utf-8"))).toBe("Název");
    // "Název" in windows-1250: á = 0xE1
    expect(decodeCsvBuffer(Buffer.from([0x4e, 0xe1, 0x7a, 0x65, 0x76]))).toBe("Název");
  });
});
