import { describe, expect, it, vi } from 'vitest';
import { sendEetRequest } from '../eet/client.js';

const OK = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><eet:Odpoved xmlns:eet="http://fs.gov.cz/eet/schema/v4"><eet:Hlavicka uuid_zpravy="b3a09b52-7c87-4014-a496-4c7a53cf9125" dat_prij="2027-01-09T04:25:29+01:00"/><eet:Potvrzeni pok="987a6be5-6af5-44f3-b4fc-987654321000-ff" test="true"/></eet:Odpoved></soapenv:Body></soapenv:Envelope>`;

describe('sendEetRequest (no network: fetch is mocked)', () => {
  it('posts to the playground by default with the WSDL SOAPAction', async () => {
    const fetchMock = vi.fn(async () => new Response(OK, { status: 200, headers: { 'X-Global-Transaction-Id': 'abc123' } }));
    const r = await sendEetRequest('<x/>', { fetch: fetchMock as unknown as typeof fetch });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://pg.trzbyeet.gov.cz/eet/services/EETServiceSOAP/v4');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'http://fs.gov.cz/eet/OdeslaniTrzby' });
    expect(r).toMatchObject({ sent: true, httpStatus: 200, transactionId: 'abc123', response: { kind: 'confirmed', test: true } });
  });

  it('reports a timeout as not sent, so the § 20 resend kicks in', async () => {
    const fetchMock = vi.fn(async () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    });
    expect(await sendEetRequest('<x/>', { fetch: fetchMock as unknown as typeof fetch })).toEqual({ sent: false, reason: 'timeout', transactionId: null });
  });

  it('reports a connection failure as network', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await sendEetRequest('<x/>', { fetch: fetchMock as unknown as typeof fetch })).toMatchObject({ sent: false, reason: 'network' });
  });

  it('never waits less than the 2 s the law requires', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    const fetchMock = vi.fn(async () => new Response(OK));
    await sendEetRequest('<x/>', { fetch: fetchMock as unknown as typeof fetch, timeoutMs: 100 });
    expect(spy).toHaveBeenCalledWith(2000);
    spy.mockRestore();
  });
});
