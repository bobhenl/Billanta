'use client';

import { useEffect, useState } from 'react';
import { isSealed, open } from '@faktur/cz-compliance';
import { openContacts } from '@/lib/vault/contacts';
import { useVault } from './vault-provider';

type Row = Parameters<typeof openContacts>[1][number];

/**
 * The rows with their encrypted contact fields opened in this browser, so
 * a list can filter, sort and match by name without the server. Until the
 * key is here the rows come back as stored (names render locked).
 */
export function useOpenedContacts<T extends Row>(rows: T[]): T[] {
  const { key } = useVault();
  const [opened, setOpened] = useState<T[]>(rows);

  useEffect(() => {
    setOpened(rows);
    if (!key) return;
    let live = true;
    void openContacts(key, rows).then((list) => live && setOpened(list));
    return () => {
      live = false;
    };
  }, [key, rows]);

  return opened;
}

/**
 * The same for rows that carry a contact's name under another field (an
 * invoice's `contactName`, a transaction's `counterpartyName` …). The opened
 * text stays in this tab; nothing goes back to the server.
 */
export function useOpenedFields<T extends object, K extends keyof T>(rows: T[], fields: readonly K[]): T[] {
  const { key } = useVault();
  const [opened, setOpened] = useState<T[]>(rows);
  const fieldList = fields.join('|');

  useEffect(() => {
    setOpened(rows);
    const names = fieldList.split('|') as K[];
    if (!key || !rows.some((row) => names.some((f) => isSealed(row[f])))) return;
    let live = true;
    void Promise.all(
      rows.map(async (row) => {
        const out = { ...row };
        for (const f of names) {
          const value = row[f];
          if (isSealed(value)) out[f] = (await open(key, value).catch(() => value)) as T[K];
        }
        return out;
      })
    ).then((list) => live && setOpened(list));
    return () => {
      live = false;
    };
  }, [key, rows, fieldList]);

  return opened;
}
