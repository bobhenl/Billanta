# packages/cz-compliance

Shared TypeScript library used by both the frontend and the backend
(`@faktur/cz-compliance`, `workspace:*`). It covers:

- ARES / RPO / foreign registry lookups and VAT status;
- ISDOC 6.0.2 and UBL generators;
- SPAYD and QR-faktura payment QR codes;
- CZ/SK bank account validation;
- invoice requirements, public holidays, working days, tax deadlines,
  law links and number formatting.

Parts are ported from MIT-licensed Faktorio; see `THIRD_PARTY_NOTICES.md`.

```bash
pnpm --filter @faktur/cz-compliance build   # consumers import dist/, rebuild after changes
pnpm --filter @faktur/cz-compliance test    # vitest, src/__tests__/*.test.ts
pnpm --filter @faktur/cz-compliance typecheck
```

## Rules

- **Framework-free.** No Nest, React, Next or DB imports. Only the
  registry clients do I/O (global `fetch`). Everything else is pure.
- ESM: relative imports end in `.js`. Re-export every new module from
  `src/index.ts`.
- Legal rules (VAT, mandatory invoice fields, deadlines) cite the law
  (paragraph or link) in a comment. Every rule has a test, including the
  edge cases: leap years, holidays, end of month, the SK vs CZ difference.
- Round amounts the way the existing generators do (`roundMoney`, two
  decimals) so totals in PDF, ISDOC, UBL and QR all agree.
- Changes affect both apps. After changing an export, run the typecheck in
  `apps/frontend` and `apps/backend` too.
