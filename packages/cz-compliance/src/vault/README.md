# Billanta vault crypto

The browser-side encryption behind Billanta's Confidential mode ("Důvěrný
režim"). It is one file, `confidential.ts`, with no imports: only the
WebCrypto API that browsers and Node 20+ ship. It is kept in its own folder
so it can be published and reviewed on its own.

## What it does

- Each company has one random AES-GCM 256 data key, created in the browser
  (`generateDataKey`).
- The server stores only wrapped copies of that key: wrapped with a vault
  password (PBKDF2-SHA256, 600 000 iterations), with a passkey (WebAuthn PRF
  output through HKDF-SHA256) or with a 30-character recovery code (150 bits,
  HKDF-SHA256). See `wrapWithPassword`, `wrapWithSecret`,
  `wrapWithRecoveryCode`.
- A text is stored as `enc:v1:<base64 IV>:<base64 ciphertext+tag>`, with a
  fresh 12-byte IV per text (`seal`, `open`). `isSealed` is how every reader,
  including the server, tells an envelope from plain text.
- After unlocking, the browser keeps a non-extractable copy of the key
  (`sessionKey`): page scripts can use it, but cannot read its bytes.
- `keyCheck` stores one known text sealed with the key, so a wrong password
  or code is recognised without ever sending the key anywhere.

## What it does not do

- It does not protect against code that runs in the page. The app, this file
  included, is delivered by the Billanta server, so a compromised or
  malicious server could ship different code. Publishing this file and the
  SHA-256 hashes of the built chunks lets anyone compare what their browser
  runs with this source; it does not make that comparison automatic.
- It does not hide amounts, dates, numbers, symbols or customers. Only item
  descriptions and notes are sealed.
- When a member chooses to e-mail the PDF of an encrypted document, its text
  passes through the server once, because the e-mail is sent from there.

## Files

- `confidential.ts`: the envelope format, AES-GCM, key derivation and key
  wrapping.
- `confidential.test.ts`: its tests.
- `manifest.mjs`: Node script helpers that hash this source and every built
  JavaScript file containing it (found by the key-check text). The app
  publishes the result at `/.well-known/billanta-vault.json`.

Nothing here knows about plans, endpoints, invoices or configuration. The
app calls into these files; they never call into the app.

## Checking a build

1. Compare the `source.sha256` in `/.well-known/billanta-vault.json` with
   `sha256sum confidential.ts` from this repository.
2. Download each listed chunk from the site and compare its SHA-256 with the
   manifest. Your browser's DevTools (Network) show which of them a page
   actually loaded.

## Tests

`confidential.test.ts` (vitest) covers sealing and opening, wrong secrets,
the recovery code format and the key check.

## Licence

MIT.
