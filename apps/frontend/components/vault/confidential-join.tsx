'use client';

import { useEffect, useState } from 'react';
import { isSealed, open } from '@faktur/cz-compliance';
import { ConfidentialText } from './confidential-text';
import { useVault } from './vault-provider';

/** The values with their envelopes opened here; null until the key is here (or while any of them won't open). */
function useOpened(values: (string | null | undefined)[]): (string | null | undefined)[] | null {
  const { key } = useVault();
  const sealed = values.some(isSealed);
  const joined = JSON.stringify(values);
  const [opened, setOpened] = useState<(string | null | undefined)[] | null>(sealed ? null : values);

  useEffect(() => {
    const list = JSON.parse(joined) as (string | null)[];
    if (!list.some(isSealed)) return setOpened(list);
    if (!key) return setOpened(null);
    let live = true;
    Promise.all(list.map((v) => (v && isSealed(v) ? open(key, v) : v)))
      .then((out) => live && setOpened(out))
      .catch(() => live && setOpened(null));
    return () => {
      live = false;
    };
  }, [joined, key]);

  return opened;
}

/**
 * Several possibly encrypted parts shown as one line (an address: street,
 * ZIP and city), opened in the browser. Locked, it shows the lock once.
 */
export function ConfidentialJoin({ parts, separator = ', ', className }: { parts: (string | null | undefined)[]; separator?: string; className?: string }) {
  const opened = useOpened(parts);
  if (!opened) return <ConfidentialText value={parts.find(isSealed)} className={className} />;
  return <span className={className}>{opened.filter(Boolean).join(separator)}</span>;
}

/** A mailto: or tel: link whose address may be encrypted; the link exists only once it is opened. */
export function ConfidentialLink({ value, kind, className }: { value: string; kind: 'mailto' | 'tel'; className?: string }) {
  const opened = useOpened([value]);
  const plain = opened?.[0];
  if (!plain) return <ConfidentialText value={value} />;
  const href = kind === 'mailto' ? `mailto:${plain}` : `tel:${plain.replace(/[^+0-9]/g, '')}`;
  return (
    <a href={href} className={className}>
      {plain}
    </a>
  );
}
