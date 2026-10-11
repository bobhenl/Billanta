import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ParsedBankTransactionRow } from "./csv-parser";

/**
 * Minimal client for the Enable Banking API (https://enablebanking.com/docs/api/reference/),
 * a licensed PSD2 aggregator used here for account information only: the
 * company signs in at its own bank, grants read access for up to 180 days,
 * and the hourly sync pulls incoming payments. Nothing can be paid with it.
 *
 * Every request carries a short-lived RS256 JWT signed with the platform's
 * application key (`ENABLE_BANKING_APP_ID` + `ENABLE_BANKING_PRIVATE_KEY`
 * or `ENABLE_BANKING_PRIVATE_KEY_PATH`).
 */

export class EnableBankingError extends Error {
  constructor(
    message: string,
    readonly code: "not_configured" | "consent_expired" | "rate_limited" | "rejected" | "unavailable" | "bad_response",
  ) {
    super(message);
  }
}

export interface EnableBankingConfig {
  appId: string;
  privateKey: string;
  baseUrl: string;
}

export function enableBankingConfig(env: NodeJS.ProcessEnv = process.env): EnableBankingConfig | null {
  const appId = env.ENABLE_BANKING_APP_ID?.trim();
  let privateKey = env.ENABLE_BANKING_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!privateKey && env.ENABLE_BANKING_PRIVATE_KEY_PATH) {
    try {
      privateKey = readFileSync(env.ENABLE_BANKING_PRIVATE_KEY_PATH, "utf8").trim();
    } catch {
      privateKey = undefined;
    }
  }
  if (!appId || !privateKey) return null;
  return { appId, privateKey, baseUrl: (env.ENABLE_BANKING_API_BASE_URL ?? "https://api.enablebanking.com").replace(/\/$/, "") };
}

const b64url = (input: string | Buffer) => Buffer.from(input).toString("base64url");

/** The application JWT Enable Banking expects (max 24 h validity; we use 1 h). */
export function signAppJwt(config: Pick<EnableBankingConfig, "appId" | "privateKey">, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "RS256", kid: config.appId }));
  const payload = b64url(JSON.stringify({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat, exp: iat + 3600 }));
  const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(config.privateKey);
  return `${header}.${payload}.${b64url(signature)}`;
}

export interface Aspsp {
  name: string;
  country: string;
  logo: string | null;
  /** Longest consent the bank allows, in seconds. */
  maximumConsentValidity: number | null;
  psuTypes: string[];
}

export interface EnableBankingAccount {
  uid: string;
  iban: string | null;
  name: string | null;
  currency: string | null;
}

export interface EnableBankingSession {
  sessionId: string;
  accounts: EnableBankingAccount[];
  validUntil: Date | null;
}

export interface Psd2SyncedRow extends ParsedBankTransactionRow {
  externalId: string;
}

/**
 * Czech and Slovak banks pass the variable symbol in the remittance text
 * ("/VS/2026001", "VS: 2026001", "VS2026001/SS/KS") or as the structured
 * reference. A remittance consisting of digits only is taken as the VS too.
 */
export function extractVariableSymbol(parts: (string | null | undefined)[]): string | null {
  const texts = parts.filter((p): p is string => typeof p === "string" && p.trim() !== "");
  for (const text of texts) {
    const match = text.match(/(?:^|[^A-Z])VS[\s:/.=-]*0*(\d{1,10})(?!\d)/i);
    if (match) return match[1]!;
  }
  for (const text of texts) {
    const digits = text.trim();
    if (/^\d{1,10}$/.test(digits)) return digits.replace(/^0+(?=\d)/, "");
  }
  return null;
}

type RawTransaction = {
  entry_reference?: string | null;
  transaction_id?: string | null;
  transaction_amount?: { amount?: string | number; currency?: string } | null;
  credit_debit_indicator?: string | null;
  status?: string | null;
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  debtor?: { name?: string | null } | null;
  debtor_account?: { iban?: string | null; other?: { identification?: string | null } | null } | null;
  remittance_information?: string[] | null;
  reference_number?: string | null;
  end_to_end_id?: string | null;
};

function parseDay(raw: string | null | undefined): Date | null {
  const match = raw?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
}

/**
 * Booked incoming payments only. The id prefers the bank's own entry
 * reference so overlapping windows don't store a payment twice; without one
 * it falls back to a fingerprint of date, amount and remittance.
 */
export function parseTransactions(accountUid: string, raw: RawTransaction[]): Psd2SyncedRow[] {
  const rows: Psd2SyncedRow[] = [];
  for (const tx of raw) {
    if (tx.credit_debit_indicator !== "CRDT") continue;
    if (tx.status && tx.status !== "BOOK") continue;
    const amount = Number(tx.transaction_amount?.amount);
    const date = parseDay(tx.booking_date) ?? parseDay(tx.value_date) ?? parseDay(tx.transaction_date);
    if (!Number.isFinite(amount) || amount <= 0 || !date) continue;

    const remittance = tx.remittance_information ?? [];
    const ref =
      tx.entry_reference ||
      tx.transaction_id ||
      `${date.toISOString().slice(0, 10)}|${amount.toFixed(2)}|${remittance.join(" ").slice(0, 120)}|${tx.debtor_account?.iban ?? ""}`;
    rows.push({
      externalId: `psd2:${accountUid}:${ref}`.slice(0, 300),
      transactionDate: date,
      amount: amount.toFixed(2),
      currency: (tx.transaction_amount?.currency ?? "CZK").toUpperCase().slice(0, 3),
      variableSymbol: extractVariableSymbol([...remittance, tx.reference_number, tx.end_to_end_id]),
      counterpartyAccount: tx.debtor_account?.iban ?? tx.debtor_account?.other?.identification ?? null,
      counterpartyName: tx.debtor?.name ?? null,
    });
  }
  return rows;
}

export class EnableBankingClient {
  constructor(
    private readonly config: EnableBankingConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${signAppJwt(this.config)}`,
          ...(body !== undefined && { "Content-Type": "application/json" }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(25_000),
      });
    } catch {
      throw new EnableBankingError("Enable Banking is not reachable", "unavailable");
    }
    if (response.status === 429) throw new EnableBankingError("Rate limited", "rate_limited");
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const expired = /EXPIRED|CLOSED|REVOKED|INVALID_SESSION|NOT_AUTHORIZED/i.test(text);
      if (path.startsWith("/accounts/") && (response.status === 401 || response.status === 403 || expired)) {
        throw new EnableBankingError("Consent expired or revoked", "consent_expired");
      }
      if (response.status >= 400 && response.status < 500) {
        throw new EnableBankingError(`Enable Banking rejected the request (${response.status})`, "rejected");
      }
      throw new EnableBankingError(`Enable Banking answered ${response.status}`, "unavailable");
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new EnableBankingError("Response is not JSON", "bad_response");
    }
  }

  async listBanks(country: string): Promise<Aspsp[]> {
    const body = await this.request<{ aspsps?: Record<string, unknown>[] }>("GET", `/aspsps?country=${encodeURIComponent(country)}`);
    return (body.aspsps ?? []).map((a) => ({
      name: String(a.name ?? ""),
      country: String(a.country ?? country),
      logo: typeof a.logo === "string" ? a.logo : null,
      maximumConsentValidity: typeof a.maximum_consent_validity === "number" ? a.maximum_consent_validity : null,
      psuTypes: Array.isArray(a.psu_types) ? a.psu_types.map(String) : [],
    })).filter((a) => a.name);
  }

  /** Starts authorisation; returns the bank URL to send the user to. */
  async startAuth(input: { bankName: string; country: string; validUntil: Date; state: string; redirectUrl: string; psuType: "business" | "personal" }) {
    const body = await this.request<{ url?: string }>("POST", "/auth", {
      access: { valid_until: input.validUntil.toISOString() },
      aspsp: { name: input.bankName, country: input.country },
      state: input.state,
      redirect_url: input.redirectUrl,
      psu_type: input.psuType,
    });
    if (!body.url) throw new EnableBankingError("No authorisation URL", "bad_response");
    return body.url;
  }

  async createSession(code: string): Promise<EnableBankingSession> {
    const body = await this.request<{
      session_id?: string;
      accounts?: { uid?: string; account_id?: { iban?: string | null } | null; name?: string | null; currency?: string | null }[];
      access?: { valid_until?: string | null } | null;
    }>("POST", "/sessions", { code });
    if (!body.session_id) throw new EnableBankingError("No session id", "bad_response");
    return {
      sessionId: body.session_id,
      accounts: (body.accounts ?? [])
        .filter((a) => a.uid)
        .map((a) => ({ uid: a.uid!, iban: a.account_id?.iban ?? null, name: a.name ?? null, currency: a.currency ?? null })),
      validUntil: body.access?.valid_until ? new Date(body.access.valid_until) : null,
    };
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.request("DELETE", `/sessions/${encodeURIComponent(sessionId)}`).catch(() => undefined);
  }

  /** Incoming booked payments since `from`, following continuation keys (capped at 20 pages). */
  async fetchIncoming(accountUid: string, from: Date): Promise<Psd2SyncedRow[]> {
    const raw: RawTransaction[] = [];
    let continuation: string | undefined;
    for (let page = 0; page < 20; page++) {
      const query = new URLSearchParams({ date_from: from.toISOString().slice(0, 10) });
      if (continuation) query.set("continuation_key", continuation);
      const body = await this.request<{ transactions?: RawTransaction[]; continuation_key?: string | null }>(
        "GET",
        `/accounts/${encodeURIComponent(accountUid)}/transactions?${query}`,
      );
      raw.push(...(body.transactions ?? []));
      if (!body.continuation_key) break;
      continuation = body.continuation_key;
    }
    return parseTransactions(accountUid, raw);
  }
}
