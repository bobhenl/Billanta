import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { LinkTelegramButton } from './link-telegram-button';

type ChannelType = 'telegram' | 'whatsapp';

interface ChannelLink {
  channel: ChannelType;
  linked: boolean;
  /** External handle/display name once linked (e.g. Telegram @username). */
  externalHandle: string | null;
  /** ISO timestamp of when the link was activated. Null when not linked. */
  linkedAt: string | null;
}

/**
 * PLACEHOLDER DATA — TODO: replace with a real fetch to
 * `GET /api/v1/channel-links` (blueprint §6) once the backend's
 * channel-links endpoint and Auth.js session/tenant context exist. Mirrors
 * one row per (tenant, channel) from the `channel_links` table.
 */
const MOCK_CHANNEL_LINKS: ChannelLink[] = [
  {
    channel: 'telegram',
    linked: true,
    externalHandle: '@novak_consulting',
    linkedAt: '2026-08-02T09:14:00.000Z'
  },
  {
    channel: 'whatsapp',
    linked: false,
    externalHandle: null,
    linkedAt: null
  }
];

export default async function ChannelsSettingsPage() {
  const t = await getTranslations('settings.channels');
  const locale = await getLocale();
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div>
      <Link href="/settings" className="text-sm text-muted-foreground hover:text-foreground">
        ← {t('back')}
      </Link>

      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="mt-1 text-muted-foreground">{t('description')}</p>

      <div className="mt-6 divide-y divide-border overflow-hidden rounded-lg border border-border">
        {MOCK_CHANNEL_LINKS.map((link) => (
          <div key={link.channel} className="flex items-center justify-between gap-4 p-4">
            <div>
              <div className="font-medium">{t(link.channel)}</div>
              {link.linked && link.externalHandle ? (
                <div className="mt-0.5 text-sm text-muted-foreground">
                  {t('linkedAs', { handle: link.externalHandle })}
                  {link.linkedAt && ` · ${dateFormatter.format(new Date(link.linkedAt))}`}
                </div>
              ) : link.channel === 'whatsapp' ? (
                <div className="mt-0.5 text-sm text-muted-foreground">{t('whatsappComingSoon')}</div>
              ) : null}
            </div>

            <span
              className={cn(
                'inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                link.linked ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'
              )}
            >
              {link.linked ? t('statusLinked') : t('statusNotLinked')}
            </span>
          </div>
        ))}
      </div>

      {/* A tenant can bind more than one external sender to the same
          business per blueprint §6 (channel_links keys on external_user_id,
          not just tenant_id) — so the "link" action stays available even
          though one Telegram sender is already linked above. WhatsApp has
          no equivalent action yet; it's Phase 6 per blueprint §10 and needs
          Meta Business Cloud API verification first. */}
      <div className="mt-6 rounded-lg border border-border p-4">
        <p className="mb-3 text-sm text-muted-foreground">{t('linkAnother')}</p>
        <LinkTelegramButton />
      </div>
    </div>
  );
}
