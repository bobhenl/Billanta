'use client';

import { useEffect, useState } from 'react';
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
