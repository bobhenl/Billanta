# Draft copy: security features not shipped yet

Copy for the "Bezpečnost a data" section on `/features`
(`featurePages.security.items` in `apps/frontend/messages/*.json`) and the
matching legal clauses. **Do not publish any of it until the feature is
merged and running in production.** When it ships, check every sentence
against the code again, add the Slovak version (real Slovak, not Czech with
a few words changed) and add the key to `SECURITY` in
`apps/frontend/app/[locale]/(marketing)/features/page.tsx`.

Facts that still need checking before publishing are marked `[ověřit]`.

## Důvěrný režim (client-side E2EE)

**cs**

- name: Důvěrný režim
- text: Popisy položek a poznámky můžete šifrovat přímo v prohlížeči. Na server odchází jen zašifrovaný text a klíč máme jen vy. Trezor odemknete heslem nebo passkey. Pro případ ztráty si uložíte obnovovací kód.
- FAQ: *Co když zapomenu heslo k trezoru?* Odemknete ho passkey nebo obnovovacím kódem. Když ztratíte všechno, zašifrované texty nepřečte nikdo, ani my.
- FAQ: *Co zůstává nezašifrované?* Částky, data, odběratel a čísla dokladů, protože z nich se počítá DPH, QR platba a přehledy. [ověřit přesný seznam polí]

**en**

- name: Confidential mode
- text: You can encrypt line descriptions and notes right in your browser. Only the encrypted text reaches our server, and only you hold the key. Unlock the vault with a password or a passkey, and keep a recovery code in case you lose both.
- FAQ: *What if I forget the vault password?* Unlock it with a passkey or the recovery code. If you lose all of them, nobody can read the encrypted text, including us.
- FAQ: *What stays unencrypted?* Amounts, dates, the customer and document numbers, because VAT, the QR payment and reports are calculated from them. [verify the exact field list]

**Legal (privacy, §9 Zabezpečení)**

- cs: Pokud si firma zapne důvěrný režim, popisy položek a poznámky se šifrují v prohlížeči uživatele. Provozovatel klíč nemá a tyto texty nemůže přečíst ani obnovit.
- en: If a company turns on confidential mode, line descriptions and notes are encrypted in the user's browser. The operator does not have the key and cannot read or recover these texts.
- Terms §13: the customer is responsible for the vault password, passkey and recovery code; lost keys mean the texts cannot be restored.

## Granular permissions

**cs**

- name: Podrobná oprávnění
- text: Kromě oblastí jako faktury nebo banka můžete členům týmu povolit nebo zakázat jednotlivé akce, třeba vystavení, odeslání nebo smazání dokladu. [ověřit seznam akcí]

**en**

- name: Detailed permissions
- text: Beyond areas such as invoices or bank, you can allow or block single actions for team members, for example issuing, sending or deleting a document. [verify the list of actions]

## Per-member client visibility

**cs**

- name: Kdo vidí kterého klienta
- text: U každého člena týmu určíte, se kterými klienty pracuje. Ostatní kontakty a jejich doklady neuvidí.

**en**

- name: Who sees which client
- text: Choose which clients each team member works with. They won't see other contacts or their documents.

**Legal (privacy, §2 Historie změn / role)**: mention that access to customer data inside the company can be limited per member. No new processor.

## Document archive in own storage

**cs**

- name: Archiv dokladů ve vašem úložišti
- text: Vystavené doklady se ukládají i do vašeho úložiště (SFTP nebo Google Disk) jako PDF a ISDOC. Archiv tak máte u sebe, i kdybyste Billantu přestali používat. [ověřit formáty a podporovaná úložiště]

**en**

- name: Document archive in your own storage
- text: Issued documents are also saved to your own storage (SFTP or Google Drive) as PDF and ISDOC, so you keep the archive even if you stop using Billanta. [verify formats and supported storage]

**Legal (terms §13)**: the customer controls that storage; it helps with the statutory archive, but responsibility for keeping documents for the required period (usually 10 years) stays with the customer.
