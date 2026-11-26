import type { Metadata } from 'next';
import { Users } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/auth';
import { Link } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { invitationPreview } from '@/lib/invitation';
import { enabledOAuthProviders } from '@/lib/oauth-providers';
import { AcceptInvite } from './accept-invite';
import { InviteSignup } from './invite-signup';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('invite');
  return { title: t('title') };
}

/**
 * Landing page of an emailed team invitation (`/<locale>/invite/<token>`, built by
 * `TeamService.invite`). In the auth group, not the dashboard, because the
 * invitee often has no account yet: they get a short signup that joins this
 * company instead of founding their own. A signed-in invitee just accepts.
 */
export default async function InvitePage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const t = await getTranslations('invite');
  const tRoles = await getTranslations('settings.team.roles');
  const tAreas = await getTranslations('settings.team.areas');
  const tLevels = await getTranslations('settings.team.levels');
  const [session, preview] = await Promise.all([auth().catch(() => null), invitationPreview(token)]);
  const signedIn = Boolean(session?.user) && session?.twoFactor !== 'pending';
  const emailMismatch = preview !== null && signedIn && session?.user?.email?.toLowerCase() !== preview.email.toLowerCase();
  const usable = preview !== null && !preview.accepted && !preview.expired;

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Users className="h-6 w-6" />
          </span>
          {!preview ? (
            <>
              <h1 className="mt-4 text-xl font-extrabold">{t('notFound')}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{t('notFoundHint')}</p>
            </>
          ) : (
            <>
              <h1 className="mt-4 text-xl font-extrabold">{t('heading', { company: preview.companyName })}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{t('asRole', { role: tRoles(preview.role) })}</p>
            </>
          )}
        </div>
        {preview && usable && (
          <div className="mt-5 rounded-lg border border-border bg-muted/30 p-4">
            <h2 className="text-sm font-semibold">{t('accessTitle')}</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {preview.access.areas.map(({ area, level }) => (
                <li key={area} className="flex items-center justify-between gap-3">
                  <span>{tAreas(area)}</span>
                  <span className={level === 'none' ? 'text-muted-foreground' : 'font-medium'}>{tLevels(level)}</span>
                </li>
              ))}
            </ul>
            {preview.access.manage && <p className="mt-2 text-xs text-muted-foreground">{t('accessManage')}</p>}
          </div>
        )}
        {preview && (
          <div className="mt-5">
            {preview.accepted ? (
              <Banner tone="ok">{t('alreadyAccepted')}</Banner>
            ) : preview.expired ? (
              <Banner tone="warn">{t('expired')}</Banner>
            ) : emailMismatch ? (
              <Banner tone="warn">{t('emailMismatch', { email: preview.email })}</Banner>
            ) : signedIn ? (
              <AcceptInvite token={token} />
            ) : (
              <InviteSignup token={token} email={preview.email} providers={enabledOAuthProviders()} />
            )}
          </div>
        )}
        {(signedIn || !usable) && (
          <div className="mt-5 text-center">
            <Link href={signedIn ? '/dashboard' : '/login'} className="text-sm text-muted-foreground hover:text-primary">
              {signedIn ? t('toDashboard') : t('toLogin')}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
