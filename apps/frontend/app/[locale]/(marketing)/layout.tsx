import { Clarity } from '@/components/clarity';
import { CookieConsent } from '@/components/cookie-consent';
import { MarketingFooter } from '@/components/marketing-footer';
import { MarketingNavbar } from '@/components/marketing-navbar';
import { MarketingTabBar } from '@/components/marketing-tab-bar';

/**
 * Shared chrome for every public, indexable page (home, pricing, about,
 * legal, invoicing): header, footer and the phone tab bar, so no public
 * page ships without navigation or internal links.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingNavbar />
      <main className="flex-1">{children}</main>
      <div className="pb-tabbar">
        <MarketingFooter />
      </div>
      <MarketingTabBar />
      {/* Consent + analytics live on the public pages only — never in the
          dashboard, where Clarity would record invoice contents. */}
      <CookieConsent />
      <Clarity />
    </div>
  );
}
