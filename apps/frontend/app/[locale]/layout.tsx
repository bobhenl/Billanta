import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Inter, Fraunces } from 'next/font/google';
import { hasLocale } from '@/i18n/has-locale';
import { routing } from '@/i18n/routing';
import { ThemeProvider } from '@/components/theme-provider';
import { SessionProvider } from '@/components/session-provider';
import { SITE_URL } from '@/lib/site';
import '../globals.css';

const inter = Inter({ subsets: ['latin', 'latin-ext'] });

// Marketing-only display serif (headlines on the public homepage) — kept
// separate from `inter`, the body/UI font used everywhere else including
// the dashboard. Exposed as the `--font-display` CSS variable (see
// `tailwind.config.ts`'s `fontFamily.display`) rather than a `.className`
// so it never overrides Inter on `<body>`; components opt in with the
// `font-display` utility class instead.
const fraunces = Fraunces({
  subsets: ['latin', 'latin-ext'],
  weight: ['500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-display'
});

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
  // the product's user-facing name in translated contexts — it's a
  // provisional placeholder ("Faktur") pending a final branding/naming
  // decision, so every translated surface must read it from here rather
  // than hardcoding the literal string. See `lib/site.ts`'s `SITE_NAME` for
  // the non-translated-context equivalent.
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
      type: 'website'
    },
    twitter: {
      card: 'summary_large_image'
    }
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
      <body className={`${inter.className} ${fraunces.variable}`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <NextIntlClientProvider messages={messages}>
            {/* Makes useSession() available to client components anywhere
                below (e.g. login-form.tsx) without turning this server
                layout itself into a client component — see
                session-provider.tsx's doc comment. */}
            <SessionProvider>{children}</SessionProvider>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
