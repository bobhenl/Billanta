import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Inter } from 'next/font/google';
import { hasLocale } from 'next-intl';
import { routing } from '@/i18n/routing';
import { ThemeProvider } from '@/components/theme-provider';
import { SessionProvider } from '@/components/session-provider';
import { ToastFromQuery, Toaster } from '@/components/toaster';
import { Suspense } from 'react';
import { SITE_URL } from '@/lib/site';
import { OG_IMAGE } from '@/lib/seo';
import '../globals.css';

const inter = Inter({ subsets: ['latin', 'latin-ext'], variable: '--font-sans', display: 'swap' });

// Browser chrome (mobile address bar, PWA title bar) follows the page
// ground in each scheme — the same two hexes as --background in globals.css.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f6fb' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0c14' }
  ]
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  // `app.name` (messages/{cs,sk,en}.json) is the single source of truth for
  // the product's user-facing name in translated contexts; `lib/site.ts`'s
  // `SITE_NAME` is the non-translated equivalent.
  const t = await getTranslations({ locale, namespace: 'app' });

  return {
    // Lets every page use relative URLs in its own `alternates`/`openGraph`
    // fields (e.g. `canonical: '/'`) instead of every page having to
    // reconstruct `SITE_URL` itself — pages that need a fully custom
    // canonical/hreflang set (homepage, faktury-pro/[slug]) still define
    // their own `generateMetadata` on top of this; this is just the
    // sitewide fallback so no page silently ships with none at all.
    metadataBase: new URL(SITE_URL),
    title: {
      default: t('name'),
      template: `%s · ${t('name')}`
    },
    description: t('tagline'),
    openGraph: {
      siteName: t('name'),
      locale,
      type: 'website',
      images: [OG_IMAGE]
    },
    twitter: {
      card: 'summary_large_image'
    },
    applicationName: t('name'),
    formatDetection: { telephone: false }
  };
}

export default async function LocaleLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  // Enables static rendering for this locale segment — see
  // https://next-intl.dev/docs/getting-started/app-router/with-i18n-routing
  setRequestLocale(locale);

  const messages = await getMessages();

  return (
    // suppressHydrationWarning is the documented next-themes pattern: it
    // sets the dark/light class on <html> before hydration, which would
    // otherwise trip React's hydration mismatch warning for this attribute.
    <html lang={locale} suppressHydrationWarning>
      <body className={`${inter.variable} font-sans`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <NextIntlClientProvider messages={messages}>
            {/* Makes useSession() available to client components anywhere
                below (e.g. login-form.tsx) without turning this server
                layout itself into a client component — see
                session-provider.tsx's doc comment. */}
            <SessionProvider>{children}</SessionProvider>
            <Toaster />
            <Suspense fallback={null}>
              <ToastFromQuery />
            </Suspense>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
