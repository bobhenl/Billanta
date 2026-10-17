import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkVatPayer, parseAdisResponse } from '../vat-payer-check.js';

// Trimmed from a real ADIS answer (2026-10) for two DIČ in one request.
const ADIS_XML =
  '<?xml version="1.0" encoding="utf-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Header/><soapenv:Body>' +
  '<StatusNespolehlivyPlatceRozsirenyResponse xmlns="http://adis.mfcr.cz/rozhraniCRPDPH/"><status odpovedGenerovana="2026-10-17" statusCode="0" statusText="OK"/>' +
  '<statusPlatceDPH dic="27604977" nespolehlivyPlatce="NE" cisloFu="451"><zverejneneUcty><ucet datumZverejneni="2013-04-01"><standardniUcet cislo="2047300106" kodBanky="2600"/></ucet>' +
  '<ucet datumZverejneni="2020-01-01"><standardniUcet predcisli="19" cislo="123457" kodBanky="0100"/></ucet></zverejneneUcty>' +
  '<nazevSubjektu>GOOGLE CZECH REPUBLIC, </nazevSubjektu><adresa><mesto>PRAHA 5</mesto></adresa></statusPlatceDPH>' +
  '<statusPlatceDPH dic="11111111" nespolehlivyPlatce="ANO" cisloFu="451"><nazevSubjektu>Firma s.r.o.</nazevSubjektu></statusPlatceDPH>' +
  '<statusPlatceDPH dic="99999999" nespolehlivyPlatce="NENALEZEN"/></StatusNespolehlivyPlatceRozsirenyResponse></soapenv:Body></soapenv:Envelope>';

describe('parseAdisResponse', () => {
  it('reads a reliable payer with its published accounts', () => {
    expect(parseAdisResponse(ADIS_XML, '27604977')).toEqual({
      state: 'payer',
      source: 'ADIS',
      name: 'GOOGLE CZECH REPUBLIC',
      bankAccounts: ['2047300106/2600', '19-123457/0100'],
    });
  });
  it('flags an unreliable payer', () => {
    expect(parseAdisResponse(ADIS_XML, '11111111').state).toBe('unreliable');
  });
  it('reads NENALEZEN as not registered', () => {
    expect(parseAdisResponse(ADIS_XML, '99999999').state).toBe('not_registered');
  });
  it('is unknown for an error status or a missing DIČ', () => {
    expect(parseAdisResponse(ADIS_XML.replace('statusCode="0"', 'statusCode="2"'), '27604977').state).toBe('unknown');
    expect(parseAdisResponse(ADIS_XML, '12345678').state).toBe('unknown');
  });
});

describe('checkVatPayer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('rejects input that is not a VAT id', async () => {
    expect(await checkVatPayer('hello')).toBeNull();
  });

  it('asks ADIS for a bare Czech number', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(ADIS_XML, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await checkVatPayer('276 049 77');
    expect(r).toMatchObject({ vatId: 'CZ27604977', state: 'payer', source: 'ADIS' });
    expect(String(fetchMock.mock.calls[0]![0])).toContain('adisrws.mfcr.cz');
  });

  it('falls back to VIES when ADIS is down', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ valid: true, name: 'GOOGLE' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await checkVatPayer('CZ27604977')).toMatchObject({ state: 'valid', source: 'VIES', name: 'GOOGLE' });
  });

  it('uses VIES for other EU states and reads an invalid number', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ valid: false, name: '---' }), { status: 200 })));
    expect(await checkVatPayer('SK2020317068')).toMatchObject({ vatId: 'SK2020317068', state: 'invalid', name: null });
  });

  it('never turns an outage into "not a payer"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
    expect((await checkVatPayer('DE123456789'))?.state).toBe('unknown');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ valid: false, userError: 'MS_UNAVAILABLE' }), { status: 200 })));
    expect((await checkVatPayer('DE123456789'))?.state).toBe('unknown');
  });
});
