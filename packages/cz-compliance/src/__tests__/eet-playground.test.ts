import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatEetDateTime } from '../eet-fields.js';
import { sendEetRequest } from '../eet/client.js';
import { readPkcs12 } from '../eet/pkcs12.js';
import { buildSignedEetRequest, createEetHeader } from '../eet/soap.js';

// Real round trip to the official PLAYGROUND (never production). Off by
// default so CI and normal runs stay offline; run it on purpose with
//   EET_PLAYGROUND=1 pnpm --filter @faktur/cz-compliance test eet-playground
const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'eet');

describe.skipIf(process.env.EET_PLAYGROUND !== '1')('EET playground round trip', () => {
  const p12 = () =>
    readPkcs12(readFileSync(join(dir, 'CA_EET-Playground-CZ00000019.p12')), readFileSync(join(dir, 'playground-password.txt'), 'utf8').trim());
  const data = () => ({
    eicPopl: 'CZ00000019',
    idJednotky: '181',
    idPokl: 'BILLANTA-TEST',
    poradCis: `T/${Date.now()}`,
    datTrzby: formatEetDateTime(new Date()),
    celkTrzba: '1.00',
  });

  it('gets a playground POK (ending in -ff, test="true")', async () => {
    const { xml } = buildSignedEetRequest({ header: createEetHeader({ first: true }), data: data() }, p12());
    const r = await sendEetRequest(xml, { environment: 'playground', timeoutMs: 15_000 });
    expect(r.sent).toBe(true);
    if (!r.sent) return;
    expect(r.response).toMatchObject({ kind: 'confirmed', test: true });
    if (r.response.kind === 'confirmed') expect(r.response.pok).toMatch(/-ff$/);
  }, 30_000);

  it('verification mode answers with error 0', async () => {
    const { xml } = buildSignedEetRequest({ header: createEetHeader({ first: true, overeni: true }), data: data() }, p12());
    const r = await sendEetRequest(xml, { environment: 'playground', timeoutMs: 15_000 });
    expect(r.sent && r.response).toMatchObject({ kind: 'error', code: 0 });
  }, 30_000);

  it('a tampered body is rejected with error 4 (invalid signature)', async () => {
    const { xml } = buildSignedEetRequest({ header: createEetHeader({ first: true }), data: data() }, p12());
    const r = await sendEetRequest(xml.replace('celk_trzba="1.00"', 'celk_trzba="2.00"'), { environment: 'playground', timeoutMs: 15_000 });
    expect(r.sent && r.response).toMatchObject({ kind: 'error', code: 4 });
  }, 30_000);
});
