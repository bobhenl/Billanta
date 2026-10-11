import type { Metadata } from 'next';
import { Users } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { auth } from '@/auth';
import { Link, redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { apiFetch, ApiError, NotSignedInError } from '@/lib/api-client';
import { AcceptInvite } from './accept-invite';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('invite');
  return { title: t('title') };
}

interface Preview {
  companyName: string;
  role: string;
  email: string;
  expired: boolean;
  accepted: boolean;
}

/** Landing page of an emailed team invitation (`/invite/<token>`, built by `TeamService.invite`). */
export default async function InvitePage(props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const locale = await getLocale();
  const t = await getTranslations('invite');
  const tRoles = await getTranslations('settings.team.roles');
  const session = await auth();

  let preview: Preview | null = null;
  try {
    preview = await apiFetch<Preview>(`/api/v1/invitations/${encodeURIComponent(params.token)}`);
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }

  const emailMismatch = preview !== null && session?.user?.email?.toLowerCase() !== preview.email.toLowerCase();

  return (
    <div className="mx-auto max-w-md py-8">
      <div className="rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
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
            <div className="mt-5 text-left">
              {preview.accepted ? (
                <Banner tone="ok">{t('alreadyAccepted')}</Banner>
              ) : preview.expired ? (
                <Banner tone="warn">{t('expired')}</Banner>
              ) : emailMismatch ? (
                <Banner tone="warn">{t('emailMismatch', { email: preview.email })}</Banner>
              ) : (
                <AcceptInvite token={params.token} />
              )}
            </div>
          </>
        )}
        <Link href="/dashboard" className="mt-5 inline-block text-sm text-muted-foreground hover:text-primary">
          {t('toDashboard')}
        </Link>
      </div>
    </div>
  );
}
