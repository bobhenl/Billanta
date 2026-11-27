import {
  EET_DEFAULT_ENVIRONMENT,
  EET_ENDPOINTS,
  EET_MIN_RESPONSE_TIMEOUT_MS,
  EET_SOAP_ACTION,
  type EetEnvironment,
} from '../eet-fields.js';
import { parseEetResponse, type EetResponse } from '../eet-response.js';

export interface SendEetOptions {
  /** Defaults to the playground. Production has to be asked for explicitly. */
  environment?: EetEnvironment;
  /** Clamped to at least 2 s (§ 19 odst. 2). */
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export type SendEetResult =
  | {
      sent: true;
      httpStatus: number;
      response: EetResponse;
      /** X-Global-Transaction-Id, the support desk asks for it (section 5.4). */
      transactionId: string | null;
    }
  /** No answer in time or no connection: the § 20 resend applies. */
  | { sent: false; reason: 'timeout' | 'network'; transactionId: null };

/**
 * POSTs a signed request (section 2.3: HTTPS with TLS 1.2+, HTTP/1.1,
 * text/xml; charset=utf-8 and the SOAPAction from the WSDL). The endpoint is
 * resolved by DNS on every call; the operator warns that the IP changes.
 */
export async function sendEetRequest(xml: string, opts: SendEetOptions = {}): Promise<SendEetResult> {
  const url = EET_ENDPOINTS[opts.environment ?? EET_DEFAULT_ENVIRONMENT];
  const timeout = Math.max(opts.timeoutMs ?? 10_000, EET_MIN_RESPONSE_TIMEOUT_MS);
  const doFetch = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: EET_SOAP_ACTION },
      body: xml,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err) {
    const name = (err as { name?: string }).name;
    return { sent: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network', transactionId: null };
  }
  let text: string;
  try {
    text = await res.text();
  } catch {
    return { sent: false, reason: 'timeout', transactionId: null };
  }
  return {
    sent: true,
    httpStatus: res.status,
    response: parseEetResponse(text),
    transactionId: res.headers.get('x-global-transaction-id')?.slice(0, 64) ?? null,
  };
}
