'use client';

import { signIn } from 'next-auth/react';
import type { OAuthProviderId } from '@/lib/oauth-providers';

/** One "Continue with …" button, with the provider's own mark. */
export function OAuthButton({ provider, label, callbackUrl = '/dashboard' }: { provider: OAuthProviderId; label: string; callbackUrl?: string }) {
  return (
    <button
      type="button"
      onClick={() => signIn(provider, { callbackUrl })}
      className="inline-flex items-center justify-center gap-2.5 rounded-full border border-border bg-background px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-secondary"
    >
      <ProviderMark provider={provider} />
      {label}
    </button>
  );
}

function ProviderMark({ provider }: { provider: OAuthProviderId }) {
  const common = { className: 'h-[18px] w-[18px] shrink-0', 'aria-hidden': true } as const;
  switch (provider) {
    case 'google':
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z" />
          <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
          <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" />
          <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
        </svg>
      );
    case 'microsoft-entra-id':
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path fill="#F25022" d="M1 1h10.5v10.5H1z" />
          <path fill="#7FBA00" d="M12.5 1H23v10.5H12.5z" />
          <path fill="#00A4EF" d="M1 12.5h10.5V23H1z" />
          <path fill="#FFB900" d="M12.5 12.5H23V23H12.5z" />
        </svg>
      );
    case 'apple':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" {...common}>
          <path d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9a4.8 4.8 0 0 0-3.8-2c-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9a5 5 0 0 0-4.2 2.6c-1.8 3.1-.5 7.7 1.3 10.2.8 1.2 1.8 2.6 3.1 2.5 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4a10 10 0 0 0 1.4-2.8 4.3 4.3 0 0 1-2.1-4.2zM13.9 5c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1 .1 2.1-.6 2.8-1.4z" />
        </svg>
      );
    case 'seznam':
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <rect width="24" height="24" rx="6" fill="#CC0000" />
          <path
            fill="#fff"
            d="M15.9 6.1c-2.2-.6-6.4-.3-7.4 2.2-.9 2.4 2.4 3.4 4.6 4.2 1.4.5 1.8 1.2 1 1.9-1.4 1.1-4.4.6-6.1-.3l-.6 2.6c2.4 1 6.9 1.2 8.7-1.1 1.6-2.1-.2-3.8-2.9-4.8-1.6-.6-3.2-1-2.6-1.9.7-1 3.2-.8 4.9-.2z"
          />
        </svg>
      );
    case 'discord':
      return (
        <svg viewBox="0 0 24 24" fill="#5865F2" {...common}>
          <path d="M20.3 4.4A19.6 19.6 0 0 0 15.4 3l-.6 1.3a18 18 0 0 0-5.6 0L8.6 3a19.6 19.6 0 0 0-4.9 1.5C.6 9.1-.3 13.7.1 18.2a19.8 19.8 0 0 0 6 3l1.3-2a12.8 12.8 0 0 1-2-1l.5-.4a14 14 0 0 0 12.2 0l.5.4-2 1 1.3 2a19.7 19.7 0 0 0 6-3c.5-5.2-.9-9.8-3.6-13.8zM8 15.4c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.6 8 10.6s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4z" />
        </svg>
      );
    case 'github':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" {...common}>
          <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 0-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6 0-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.7 1.6.2 2.9.1 3.2.8.8 1.3 1.9 1.3 3.1 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1.1.9 2.2v3.3c0 .3.1.7.8.6A12 12 0 0 0 12 .3" />
        </svg>
      );
  }
}
