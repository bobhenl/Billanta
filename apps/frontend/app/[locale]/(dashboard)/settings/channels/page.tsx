import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link, redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { apiFetch, NotSignedInError } from '@/lib/api-client';
import { canManage, fetchMyRole } from '@/lib/tenant';
import { LinkTelegramButton, UnlinkButton } from './link-telegram-button';
import { settingsGate } from '@/components/settings-gate';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.channels');
  return { title: t('title') };
}

/** `GET /api/v1/channel-links`: active links of the current company (no tokens). */
interface ChannelLink {
  id: string;
  channel: 'telegram' | 'whatsapp';
  externalUserId: string | null;
  displayName: string | null;
  linkedAt: string;
}

export default async function ChannelsSettingsPage() {
  const gate = await settingsGate('channels');
  if (gate) return gate;
  const t = await getTranslations('settings.channels');
  const locale = await getLocale();
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  // Bot registered with BotFather; the deep link opens it with the code.
  const botUsername = (process.env.TELEGRAM_BOT_USERNAME ?? 'billanta_bot').replace(/^@/, '');

  let links: ChannelLink[] = [];
  let role: string | null = null;
  let loadError = false;
  try {
    [links, role] = await Promise.all([apiFetch<ChannelLink[]>('/api/v1/channel-links'), fetchMyRole().catch(() => null)]);
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    loadError = true;
  }
  // If the role lookup itself failed, show the actions; the backend still refuses non-admins.
  const manage = role === null || canManage(role);
  const telegram = links.filter((link) => link.channel === 'telegram');

  return (
    <div>
      <Link href="/settings" className="text-sm text-muted-foreground hover:text-foreground">
        ← {t('back')}
      </Link>

      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="mt-1 text-muted-foreground">{t('description')}</p>

      {loadError && <Banner tone="err" className="mt-4">{t('loadError')}</Banner>}
      {!loadError && !manage && <Banner tone="info" className="mt-4">{t('readOnly')}</Banner>}

      <div className="mt-6 divide-y divide-border overflow-hidden rounded-lg border border-border">
        <div className="p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="font-medium">{t('telegram')}</div>
            <span
              className={
                telegram.length > 0
                  ? 'inline-flex shrink-0 items-center rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-medium text-success'
                  : 'inline-flex shrink-0 items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground'
              }
            >
              {telegram.length > 0 ? t('statusLinked') : t('statusNotLinked')}
            </span>
          </div>
          {telegram.length > 0 && (
            <ul className="mt-3 space-y-2">
              {telegram.map((link) => (
                <li key={link.id} className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    {t('linkedAs', { handle: link.displayName ?? `ID ${link.externalUserId ?? '?'}` })}
                    <span className="text-muted-foreground"> · {dateFormatter.format(new Date(link.linkedAt))}</span>
                  </span>
                  {manage && <UnlinkButton id={link.id} />}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center justify-between gap-4 p-4">
          <div>
            <div className="font-medium">{t('whatsapp')}</div>
            <div className="mt-0.5 text-sm text-muted-foreground">{t('whatsappComingSoon')}</div>
          </div>
          <span className="inline-flex shrink-0 items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            {t('statusNotLinked')}
          </span>
        </div>
      </div>

      {manage && !loadError && (
        <div className="mt-6 rounded-lg border border-border p-4">
          <p className="mb-3 text-sm text-muted-foreground">{telegram.length > 0 ? t('linkAnother') : t('linkFirst')}</p>
          <LinkTelegramButton botUsername={botUsername} />
          <p className="mt-3 text-xs text-muted-foreground">{t('securityNote')}</p>
        </div>
      )}
    </div>
  );
}
