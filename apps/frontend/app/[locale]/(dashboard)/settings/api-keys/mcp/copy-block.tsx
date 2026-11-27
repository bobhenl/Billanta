'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

/** A code snippet with a copy button, styled like the curl example on the API keys page. */
export function CopyBlock({ code, copyLabel, copiedLabel }: { code: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure origin, permissions): the text is still selectable.
    }
  }

  return (
    <div className="relative mt-3">
      <pre className="overflow-x-auto rounded-lg border border-border bg-muted/50 p-3 pr-12 font-mono text-xs leading-relaxed">{code}</pre>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? copiedLabel : copyLabel}
        className="absolute right-2 top-2 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-primary"
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}
