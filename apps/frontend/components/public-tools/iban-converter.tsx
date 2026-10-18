'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, XCircle } from 'lucide-react';
import { czechAccountToIban, ibanToCzechAccount, isValidCzechBankAccount, isValidIban, normalizeIban } from '@faktur/cz-compliance';
import { ResultRow, TextField } from '@/components/public-tools/fields';

/** "CZ6508000000192000145399" → "CZ65 0800 0000 1920 0014 5399". */
const groupIban = (iban: string) => iban.replace(/(.{4})/g, '$1 ').trim();

/**
 * Both directions in one field: a value starting with two letters is read as
 * an IBAN, anything else as a domestic Czech number. Each part is checked by
 * its own checksum, so "valid" means the number can exist, not that the
 * account is open.
 */
export function IbanConverter() {
  const t = useTranslations('tools.calculators.items.iban');
  const [input, setInput] = useState('19-2000145399/0800');

  const value = input.trim();
  const isIban = /^[a-z]{2}/i.test(value);
  let iban: string | null = null;
  let domestic: string | null = null;
  let valid = false;
  if (isIban) {
    iban = normalizeIban(value);
    valid = isValidIban(iban);
    domestic = valid ? ibanToCzechAccount(iban) : null;
    if (domestic && !isValidCzechBankAccount(domestic)) valid = false;
  } else if (value) {
    domestic = value.replace(/\s+/g, '');
    valid = isValidCzechBankAccount(domestic);
    iban = valid ? czechAccountToIban(domestic) : null;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <form className="space-y-4 rounded-xl border border-border bg-card p-5" onSubmit={(e) => e.preventDefault()}>
        <TextField label={t('fields.input')} value={input} onChange={setInput} hint={t('fields.inputHint')} />
      </form>
      <section aria-live="polite" className="rounded-xl border border-border bg-card p-5">
        {value ? (
          <>
            <p className={`flex items-center gap-2 font-semibold ${valid ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}>
              {valid ? <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> : <XCircle className="h-5 w-5" aria-hidden="true" />}
              {valid ? t('result.valid') : isIban ? t('result.invalidIban') : t('result.invalidAccount')}
            </p>
            {valid && (
              <dl className="mt-3 text-sm">
                {iban && <ResultRow label="IBAN" value={groupIban(iban)} />}
                {domestic && <ResultRow label={t('result.domestic')} value={domestic} />}
                {domestic && <ResultRow label={t('result.bankCode')} value={domestic.split('/')[1]!} />}
              </dl>
            )}
            {valid && isIban && !domestic && <p className="mt-3 text-xs text-muted-foreground">{t('result.foreign')}</p>}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t('result.empty')}</p>
        )}
      </section>
    </div>
  );
}
