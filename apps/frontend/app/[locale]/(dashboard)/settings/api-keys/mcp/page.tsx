import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft, Check, ShieldAlert, X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { SettingsHeader } from '@/components/settings-header';
import { settingsGate } from '@/components/settings-gate';
import { publicApiBase } from '@/lib/public-api';
import { CopyBlock } from './copy-block';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.apiKeys.mcp');
  return { title: t('title') };
}

const CAN = ['read', 'contacts', 'drafts', 'expenses', 'settings'] as const;
const CANNOT = ['issue', 'bank', 'delete', 'admin'] as const;

/** Settings → API klíče → MCP: how to connect an AI assistant to the remote MCP endpoint with an API key. */
export default async function McpGuidePage() {
  const gate = await settingsGate('apiKeys');
  if (gate) return gate;
  const t = await getTranslations('settings.apiKeys.mcp');
  const tKeys = await getTranslations('settings.apiKeys');

  const url = `${publicApiBase()}/api/v1/mcp`;
  const copy = { copyLabel: tKeys('reveal.copy'), copiedLabel: tKeys('reveal.copied') };
  const claudeCode = `claude mcp add --transport http billanta ${url} --header "Authorization: Bearer sk_live_..."`;
  // mcp-remote bridges clients that only speak stdio; the key stays in an env var instead of the args.
  // No space in the header arg: Claude Desktop on Windows splits args with spaces, so "Bearer " lives in the env value.
  const desktopConfig = JSON.stringify(
    {
      mcpServers: {
        billanta: {
          command: 'npx',
          args: ['-y', 'mcp-remote', url, '--header', 'Authorization:${BILLANTA_API_KEY}'],
          env: { BILLANTA_API_KEY: 'Bearer sk_live_...' },
        },
      },
    },
    null,
    2,
  );

  const section = 'rounded-xl border border-border bg-card p-4 sm:p-5';
  const step = (n: number) => (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{n}</span>
  );

  return (
    <div className="mx-auto max-w-3xl">
      <SettingsHeader title={t('title')} description={t('description')} />
      <Link href="/settings/api-keys" className="mt-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" />
        {t('backToKeys')}
      </Link>

      <div className="mt-6 space-y-4">
        <section className={section}>
          <h2 className="font-bold">{t('url.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('url.description')}</p>
          <CopyBlock code={url} {...copy} />
        </section>

        <section className={section}>
          <div className="flex items-start gap-3">
            {step(1)}
            <div className="min-w-0 flex-1">
              <h2 className="font-bold">{t('step1.title')}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t('step1.body')}</p>
              <Link href="/settings/api-keys" className="mt-2 inline-block text-sm font-semibold text-primary hover:underline">
                {t('step1.link')}
              </Link>
            </div>
          </div>
        </section>

        <section className={section}>
          <div className="flex items-start gap-3">
            {step(2)}
            <div className="min-w-0 flex-1">
              <h2 className="font-bold">{t('step2.title')}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t('step2.claudeCode')}</p>
              <CopyBlock code={claudeCode} {...copy} />
              <p className="mt-4 text-sm text-muted-foreground">{t('step2.desktop')}</p>
              <CopyBlock code={desktopConfig} {...copy} />
              <p className="mt-2 text-xs text-muted-foreground">{t('step2.desktopHint')}</p>
            </div>
          </div>
        </section>

        <section className={section}>
          <div className="flex items-start gap-3">
            {step(3)}
            <div className="min-w-0 flex-1">
              <h2 className="font-bold">{t('step3.title')}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t('step3.body')}</p>
            </div>
          </div>
        </section>

        <section className={section}>
          <h2 className="font-bold">{t('can.title')}</h2>
          <ul className="mt-2 space-y-1.5 text-sm">
            {CAN.map((k) => (
              <li key={k} className="flex gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>{t(`can.${k}`)}</span>
              </li>
            ))}
          </ul>
          <h2 className="mt-5 font-bold">{t('cannot.title')}</h2>
          <ul className="mt-2 space-y-1.5 text-sm">
            {CANNOT.map((k) => (
              <li key={k} className="flex gap-2">
                <X className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span>{t(`cannot.${k}`)}</span>
              </li>
            ))}
          </ul>
        </section>

        <Banner tone="info" title={t('security.title')}>
          <span className="inline-flex gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t('security.body')}</span>
          </span>
        </Banner>
      </div>
    </div>
  );
}
