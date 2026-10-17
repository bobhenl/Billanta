import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiRedirectLocation, NotSignedInError } from '@/lib/api-client';

/**
 * Starts the Google Drive consent flow: asks the backend (as the signed-in
 * owner) for the Google authorize URL and sends the browser there. Google
 * then redirects back to the backend callback, which lands on
 * `/settings/backup?connected=google_drive` (or `?error=…`).
 */
export async function GET(request: NextRequest) {
  const locale = request.nextUrl.searchParams.get('locale') ?? 'cs';
  const back = new URL(`/${encodeURIComponent(locale)}/settings/backup`, request.nextUrl.origin);
  try {
    return NextResponse.redirect(await apiRedirectLocation('/api/v1/backup-destinations/google-drive/authorize'));
  } catch (error) {
    if (error instanceof NotSignedInError) return NextResponse.redirect(new URL(`/${locale}/login`, request.nextUrl.origin));
    // 403 here is TwoFactorGuard; otherwise typically GOOGLE_CLIENT_ID isn't configured on this deployment.
    const needsTwoFactor = error instanceof ApiError && error.status === 403 && error.body.includes('two_factor_required');
    back.searchParams.set('error', needsTwoFactor ? 'two_factor_required' : 'google_drive_unavailable');
    return NextResponse.redirect(back);
  }
}
