'use client';

import { Printer } from 'lucide-react';
import { buttonClass } from '@/lib/ui-classes';

export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={buttonClass.primary}>
      <Printer className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );
}
