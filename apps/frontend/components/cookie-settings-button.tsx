'use client';

import { openConsentDialog } from '@/lib/consent';

/** Footer / cookies-page link that reopens the consent card, so consent can be withdrawn as easily as given. */
export function CookieSettingsButton({ label, className }: { label: string; className?: string }) {
  return (
    <button type="button" onClick={openConsentDialog} className={className}>
      {label}
    </button>
  );
}
