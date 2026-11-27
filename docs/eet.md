# EET 2.0 (evidence tržeb) in Billanta

Research date: 27 November 2026. All facts below come from primary sources
(the act in the Sbírka, eet.gov.cz and the Financial Administration's
technical documents). Section numbers with § are the act, the rest are the
interface description.

## Legal status

- **Act:** zákon č. 180/2026 Sb., o evidenci tržeb a o změně některých
  dalších zákonů. The Chamber outvoted the Senate on 9 September 2026, the
  President signed it on 17 September 2026, and it was published in the
  Sbírka on 7 October 2026. The eet.gov.cz news item about the publication
  is dated 15 October 2026.
- **In force:** 1 January 2027 (§ 36). The parts on certificates,
  evidenční jednotky and EIČ (§ 14, 15, 18) apply from 1 November 2026
  (§ 29), so payers can prepare in DIS+ before the start.
- **Pilot:** January 2027 is announced as a period focused on help, not on
  fines (official brochure). Fines go up to 500 000 Kč (§ 23, 24).

## What has to be recorded

- Only a **kontaktní platba** (§ 5, 6):
  - cash, card, QR or bank transfer made in person or in the provozovna or
    vehicle;
  - a payment "s hmotnou podstatou" sent remotely, e.g. cash in an envelope.
- **Not recorded:** a payment made only remotely, without personal contact.
  This covers an ordinary bank transfer for an invoice and an online card
  payment through a payment link. E-shops are "primárně necílí".
- **Exempt payers:**
  - § 11: the state, banks and similar;
  - § 11(3): paušální daň payers who chose the **EET OFF** surcharge;
  - § 11(4): some payers with a severe disability.
- **Exempt activities:** § 12 and 13.
- **No receipt duty:** EET 2.0 brings no obligation to issue or print a
  receipt (brochure). There is no simplified mode and no BKP/PKP any more.
- **Refunds and corrections** are recorded as negative amounts (§ 8). A
  refund of a payment that was not recorded does not need to be recorded.
- **Partial payments:** each payment is its own sale, recorded at the
  moment it is received (methodology, item 12).

## Timing

- Record at the latest when the sale happens, i.e. when the payment or the
  payment order is received (§ 16).
- The cash register waits at least 2 s for the answer (§ 19).
- Without an answer, the record is sent again as soon as possible, at the
  latest within 48 hours of the sale (§ 20).
- A resend uses a new message UUID and `prvni_zaslani="false"`. The `<Data>`
  stays the same, and the server treats identical `<Data>` as the same sale
  (interface section 4).

## Protocol (interface v4.1, document of 25 August 2026)

- **Transport:** SOAP 1.1 over HTTPS (TLS 1.2+), operation `OdeslaniTrzby`,
  namespace `http://fs.gov.cz/eet/schema/v4`, at most 12 kB, ASCII only.
- **Security:** WS-Security 1.1. Only `soap:Body` is signed, by `wsu:Id`,
  using:
  - exclusive C14N;
  - SHA-256 digest;
  - RSA-SHA256 signature;
  - an X509v3 BinarySecurityToken.
- **Message:**
  - `<Hlavicka uuid_zpravy dat_odesl prvni_zaslani [overeni]>`
  - `<Data eic_popl id_jednotky id_pokl porad_cis dat_trzby celk_trzba [eic_poverujiciho povereni_vice_popl urceno_cerp_zuct cerp_zuct]>`
- **Reply:**
  - `<Potvrzeni pok="…">` with a **POK** (potvrzovací kód, 39 chars). The
    POK replaces FIK; there is no BKP/PKP any more.
  - or `<Chyba kod="…">`. Only code -1 means "send again later".
  - plus up to ten `<Varovani>`.
- **Certificate:** a "pokladní certifikát", PKCS#12 with RSA 2048, valid
  366 days, issued through DIS+ (MOJE daně).
  - One certificate can serve several cash registers.
  - The certificate's CN is the EIČ (DIČ, or CZ + rodné číslo, or CZ + VČP).
- **Endpoints:**
  - playground: `https://pg.trzbyeet.gov.cz/eet/services/EETServiceSOAP/v4`
  - production: `https://trzbyeet.gov.cz/eet/services/EETServiceSOAP/v4`
- **Free state alternative:** the MOJE EET web app (up to 2 evidenční
  jednotky and 2 employees).

## What Billanta does

- **Protocol code:** `packages/cz-compliance`.
  - `eet-fields.ts` and `eet-response.ts` (pure).
  - `@faktur/cz-compliance/eet` for signing and sending: PKCS#12 reader with
    RC2/3DES/PBES2, exclusive C14N, WS-Security envelope, client.
  - Tested byte for byte against the official signed samples.
- **Settings:** EET is opt-in per company. Settings → EET holds the EIČ,
  id_jednotky, id_pokl and the uploaded pokladní certifikát (stored
  encrypted). The environment is **playground** unless the owner switches
  to production.
- **When a record is sent:** an invoice marked paid by hand with a cash
  payment method, or with a card payment method when the company says card
  payments are taken in person. Bank matching and online card payments are
  remote payments and are never sent. Undoing a recorded payment sends a
  negative record (§ 8).
- **Storage:** every record is stored in `eet_records` with its POK, and the
  invoice detail shows the latest POK.
- **Retries:** records without a POK are resent every 5 minutes for 48 hours
  (§ 20), then flagged as overdue so the owner can act.

## Sources

- Act 180/2026 Sb. (binding version): https://e-sbirka.gov.cz/sb/2026/180
- Consolidated text: https://eet.gov.cz/assets/cs/cmsmedia/o-eet/Uplne_zneni_Zakon_o_EET.pdf
- News and dates: https://eet.gov.cz/cs/informacni-servis
- Documents: https://eet.gov.cz/cs/o-eet/dokumenty-k-eet-2-0
- Brochure: https://eet.gov.cz/assets/cs/cmsmedia/o-eet/Prirucka_EET_2_0.pdf
- Methodology of the message fields (v1.0, 5 October 2026):
  https://eet.gov.cz/assets/cs/cmsmedia/pro-vyvojare/EET_popis_polozek_datove_zpravy.pdf
- Developer page: https://eet.gov.cz/cs/pro-vyvojare
- Interface description v1.2 (format v4.1, 25 August 2026):
  https://eet.gov.cz/assets/cs/cmsmedia/pro-vyvojare/EET_popis_rozhrani_v1.2.pdf
- XSD and WSDL:
  https://eet.gov.cz/assets/cs/cmsmedia/pro-vyvojare/EETXMLSchema.xsd,
  https://eet.gov.cz/assets/cs/cmsmedia/pro-vyvojare/EETServiceSOAP.wsdl
- Playground access and certificates:
  https://eet.gov.cz/assets/cs/cmsmedia/pro-vyvojare/EET_pristupove_provozni_informace_playgr-4.pdf,
  https://eet.gov.cz/assets/cs/cmsmedia/pro-vyvojare/CAEET_Playground_2026_v1.zip
- Signed sample request: https://eet.gov.cz/assets/cs/cmsmedia/pro-vyvojare/CZ00000019.eet.v4.req.xml
- Production access: https://eet.gov.cz/assets/cs/cmsmedia/pro-vyvojare/EET_pristupove_provozni_informace_Produk-4.pdf
- Developer seminar slides: https://eet.gov.cz/assets/cs/cmsmedia/pro-vyvojare/EET2_Prezentace_Seminar_pro_vyvojare_23-.pdf
