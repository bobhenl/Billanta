/**
 * What PayPal payments held in a foreign currency were really worth. Without
 * auto-conversion PayPal keeps a USD payment on the USD balance and converts
 * the balance only when the company withdraws it, at PayPal's own rate. That
 * conversion's rate (what came out / what went in) is then the rate of every
 * payment it used up, oldest first, as PayPal spends the balance.
 */

export interface BalanceConversion {
  /** When PayPal converted. */
  at: Date;
  /** What came out, e.g. CZK. */
  amount: string;
  currency: string;
  /** What went in, e.g. USD. */
  from: { amount: string; currency: string };
}

export interface HeldPayment {
  id: string;
  at: Date;
  amount: string;
  currency: string;
  /** PayPal's fee, kept back from the balance. */
  fee: string | null;
}

export interface ConvertedPayment {
  id: string;
  /** The payment after the fee, at the conversion's rate. */
  netAmount: string;
  netCurrency: string;
  rate: number;
  convertedAt: Date;
}

/** Below a cent of the converted amount left, a conversion is used up. */
const EPSILON = 0.005;

/**
 * Each conversion into the home currency takes the oldest payments still
 * held in its source currency and received before it, until their net adds
 * up to what it converted. The last one may straddle two conversions; it
 * takes the rate of the one that reached it first (the rates of two
 * withdrawals days apart differ by far less than a cent per dollar).
 */
export function convertHeldPayments(conversions: BalanceConversion[], held: HeldPayment[], home: string): ConvertedPayment[] {
  const out: ConvertedPayment[] = [];
  const done = new Set<string>();
  const pending = [...held].sort((a, b) => a.at.getTime() - b.at.getTime());
  const ordered = [...conversions].sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const conversion of ordered) {
    if (conversion.currency !== home || conversion.from.currency === home) continue;
    const source = Number(conversion.from.amount);
    const result = Number(conversion.amount);
    if (!(source > 0) || !(result > 0)) continue;
    const rate = result / source;
    let left = source;
    for (const payment of pending) {
      if (left <= EPSILON) break;
      if (done.has(payment.id) || payment.currency !== conversion.from.currency) continue;
      if (payment.at.getTime() > conversion.at.getTime()) break;
      const net = Number(payment.amount) - Math.abs(Number(payment.fee ?? 0));
      if (!(net > 0)) continue;
      done.add(payment.id);
      left -= net;
      out.push({ id: payment.id, netAmount: (Math.round(net * rate * 100) / 100).toFixed(2), netCurrency: home, rate, convertedAt: conversion.at });
    }
  }
  return out;
}
