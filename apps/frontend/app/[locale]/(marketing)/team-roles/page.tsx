import type { Metadata } from 'next';
import { ArrowRight, Calculator, Check, Crown, Eye, Minus, PlayCircle, UserCog } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CheckList, PageIntro } from '@/components/learn-page';
import { faqLd, FaqList } from '@/components/segment-page';
import { ShareQr } from '@/components/share-qr';
import { Link } from '@/i18n/navigation';
import { DEMO_VIEW_ROLES } from '@/lib/demo';
import { breadcrumbLd, jsonLd, publicPageMetadata } from '@/lib/seo';
import { SITE_NAME } from '@/lib/site';
import { buttonClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

const PATH = '/team-roles';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'learnPages.roles' });
  return publicPageMetadata({ locale, path: PATH, title: t('seoTitle'), description: t('lead') });
}

const ROLES = [
  { key: 'owner', icon: Crown, href: '/for-owners' },
  { key: 'admin', icon: UserCog, href: '/for-assistants' },
  { key: 'accountant', icon: Calculator, href: '/for-accountants' },
  { key: 'viewer', icon: Eye, href: null }
] as const;

type Level = 'write' | 'read' | 'none';

/**
 * What each role may do, column by column owner, admin, accountant, viewer.
 * Mirrors the backend: ROLE_DEFAULT_PERMISSIONS for the five areas
 * (src/tenancy/permissions.ts), ADMIN_PREFIXES in role-access.guard.ts for
 * company administration, the owner-only backups and the owner/admin-only
 * history import in invoices.controller.ts.
 */
const MATRIX: { key: string; levels: [Level, Level, Level, Level] }[] = [
  { key: 'invoices', levels: ['write', 'write', 'write', 'read'] },
  { key: 'contacts', levels: ['write', 'write', 'write', 'read'] },
  { key: 'expenses', levels: ['write', 'write', 'write', 'read'] },
  { key: 'bank', levels: ['write', 'write', 'write', 'read'] },
  { key: 'reports', levels: ['write', 'write', 'write', 'read'] },
  { key: 'settings', levels: ['write', 'write', 'none', 'none'] },
  { key: 'team', levels: ['write', 'write', 'none', 'none'] },
  { key: 'import', levels: ['write', 'write', 'none', 'none'] },
  { key: 'backups', levels: ['write', 'none', 'none', 'none'] }
];

const PRESETS = ['invoicer', 'expenses', 'auditor', 'viewer'] as const;

function LevelCell({ level, label }: { level: Level; label: string }) {
  const Icon = level === 'none' ? Minus : level === 'read' ? Eye : Check;
  return (
    <span className={cn('inline-flex items-center gap-1.5', level === 'none' ? 'text-muted-foreground' : level === 'write' ? 'font-semibold text-primary' : '')}>
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {label}
    </span>
  );
}

/** Hub of the role pages: the four roles, who each is for, and the access table. */
export default async function TeamRolesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('learnPages.roles');
  const tc = await getTranslations('learnPages.common');
  const tRoles = await getTranslations('settings.team.roles');
  const tDemoRoles = await getTranslations('demo.roles');
  const faq = t.raw('faq') as { q: string; a: string }[];

  return (
    <section className="container max-w-5xl py-10 sm:py-14">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          breadcrumbLd(locale, [
            [SITE_NAME, '/'],
            [t('title'), PATH]
          ]),
          faqLd(faq)
        ])}
      />
      <PageIntro eyebrow={t('eyebrow')} title={t('title')} lead={t('lead')}>
        <Link href="/signup" className={buttonClass.primary}>
          {tc('signup')}
        </Link>
        <Link href="/features/team-and-roles" className={buttonClass.secondary}>
          {t('featureLink')}
        </Link>
        <ShareQr />
      </PageIntro>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {ROLES.map(({ key, icon: Icon, href }) => (
          <div key={key} id={key} className="flex scroll-mt-24 flex-col rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </span>
              <div>
                <h2 className="font-bold">{tRoles(key)}</h2>
                <p className="text-sm text-muted-foreground">{t(`cards.${key}.who`)}</p>
              </div>
            </div>
            <p className="mt-3 text-sm">{t(`cards.${key}.body`)}</p>
            <CheckList className="mt-3 flex-1" items={t.raw(`cards.${key}.points`) as string[]} />
            {href && (
              <Link href={href} className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
                {t(`cards.${key}.link`)}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            )}
          </div>
        ))}
      </div>

      <h2 className="mt-12 text-xl font-bold tracking-tight">{t('tableTitle')}</h2>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t('tableLead')}</p>
      {/* Scrolls inside its own box on a phone, so the page itself never scrolls sideways. */}
      <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="p-3 font-semibold">
                {t('table.area')}
              </th>
              {ROLES.map(({ key }) => (
                <th key={key} scope="col" className="p-3 font-semibold">
                  {tRoles(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {MATRIX.map(({ key, levels }) => (
              <tr key={key}>
                <th scope="row" className="p-3 font-medium">
                  {t(`table.rows.${key}`)}
                </th>
                {levels.map((level, i) => (
                  <td key={ROLES[i]!.key} className="p-3">
                    <LevelCell level={level} label={t(`table.levels.${level}`)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t('tableNote')}</p>

      <h2 className="mt-12 text-xl font-bold tracking-tight">{t('presetsTitle')}</h2>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t('presetsLead')}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {PRESETS.map((key) => (
          <div key={key} className="rounded-xl border border-border bg-card p-5">
            <h3 className="font-bold">{t(`presets.${key}.title`)}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t(`presets.${key}.body`)}</p>
          </div>
        ))}
      </div>

      <div className="mt-12 rounded-2xl border border-primary/30 bg-primary/5 p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <PlayCircle className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          {t('demoTitle')}
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground sm:text-base">{t('demoLead')}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {DEMO_VIEW_ROLES.map((view) => (
            <Link key={view} href={view === 'owner' ? '/demo' : { pathname: '/demo', query: { view } }} className={view === 'owner' ? buttonClass.primary : buttonClass.secondary}>
              {tDemoRoles(`${view}.label`)}
            </Link>
          ))}
        </div>
      </div>

      <FaqList title={tc('faqTitle')} faq={faq} />
    </section>
  );
}
