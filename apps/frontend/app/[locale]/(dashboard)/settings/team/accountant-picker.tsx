'use client';

import { useMemo, useState } from 'react';
import { BadgeCheck, ChevronDown, Globe, Mail, MapPin, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { buttonClass, inputClass } from '@/components/modal';
import { LISTING_REGIONS, type ListingRegion, type PublicAccountant } from '@/lib/accountant-directory';
import { cn } from '@/lib/utils';

const href = (website: string) => (/^https?:\/\//i.test(website) ? website : `https://${website}`);

/**
 * Same rule as the backend's `filterListings`: a remote accountant serves
 * every region of its own country, so "online, celá ČR" shows up for Brno.
 */
function inRegion(a: PublicAccountant, region: ListingRegion | ''): boolean {
  if (!region || a.regions.includes(region)) return true;
  const country = region.slice(0, 2);
  return a.remote && (a.regions.length === 0 || a.regions.some((r) => r.startsWith(country)));
}

/**
 * "Nemáte účetní?" inside the invite modal: approved listings from the
 * public directory (/accountants). The list comes from the public endpoint,
 * which only ever returns approved listings. Inviting just fills the e-mail;
 * nothing is sent until the user confirms the invite. Websites are
 * user-supplied, not partner links, hence `nofollow ugc` as on /accountants.
 */
export function AccountantPicker({ accountants, onPick }: { accountants: PublicAccountant[]; onPick: (email: string) => void }) {
  const t = useTranslations('settings.team.directory');
  const td = useTranslations('accountantDirectory');
  const [open, setOpen] = useState(false);
  const [region, setRegion] = useState<ListingRegion | ''>('');

  // Only regions someone actually covers; an empty option list helps no one.
  const regions = useMemo(
    () => LISTING_REGIONS.filter((r) => accountants.some((a) => a.regions.includes(r) || (a.remote && a.regions.some((x) => x.startsWith(r.slice(0, 2)))))),
    [accountants]
  );
  const shown = accountants.filter((a) => inRegion(a, region));

  if (accountants.length === 0) return null;

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center gap-2 p-2.5 text-left text-sm font-semibold text-primary hover:bg-accent/50"
        onClick={() => setOpen((v) => !v)}
      >
        <BadgeCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="flex-1">{t('toggle')}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open && (
        <div className="space-y-3 border-t border-border p-2.5">
          <p className="text-xs text-muted-foreground">{t('hint')}</p>
          {regions.length > 1 && (
            <label className="block text-xs font-medium">
              {t('region')}
              <select className={cn(inputClass, 'mt-1 py-1.5')} value={region} onChange={(e) => setRegion(e.target.value as ListingRegion | '')}>
                <option value="">{t('anyRegion')}</option>
                {regions.map((r) => (
                  <option key={r} value={r}>
                    {td(`regions.${r}`)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {shown.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">{t('empty')}</p>
          ) : (
            <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {shown.map((a) => {
                const places = [...a.regions.map((r) => td(`regions.${r}`)), ...(a.remote ? [td('remote')] : [])];
                return (
                  <li key={a.id} className="flex flex-wrap items-start gap-2 p-2.5">
                    <div className="min-w-0 flex-1 basis-48">
                      <p className="font-semibold">{a.name}</p>
                      {places.length > 0 && (
                        <p className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground">
                          <MapPin className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                          <span>{places.join(', ')}</span>
                        </p>
                      )}
                      <p className="mt-1 text-xs">{a.services.map((s) => td(`services.${s}`)).join(' · ')}</p>
                      {a.bio && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{a.bio}</p>}
                      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                        {a.contactEmail && (
                          <span className="inline-flex min-w-0 items-center gap-1 break-all">
                            <Mail className="h-3 w-3 shrink-0 text-primary" aria-hidden="true" />
                            {a.contactEmail}
                          </span>
                        )}
                        {a.website && (
                          <a
                            href={href(a.website)}
                            target="_blank"
                            rel="nofollow ugc noopener"
                            className="inline-flex min-w-0 items-center gap-1 break-all text-primary hover:underline"
                          >
                            <Globe className="h-3 w-3 shrink-0" aria-hidden="true" />
                            {a.website.replace(/^https?:\/\//i, '').replace(/\/$/, '')}
                          </a>
                        )}
                      </p>
                    </div>
                    {a.contactEmail ? (
                      <button type="button" className={cn(buttonClass.secondary, 'shrink-0 py-1.5 text-xs')} onClick={() => onPick(a.contactEmail!)}>
                        <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                        {t('invite')}
                      </button>
                    ) : (
                      a.website && (
                        <a
                          href={href(a.website)}
                          target="_blank"
                          rel="nofollow ugc noopener"
                          className={cn(buttonClass.secondary, 'shrink-0 py-1.5 text-xs')}
                        >
                          <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                          {t('contact')}
                        </a>
                      )
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <Link href="/accountants" className="inline-block text-xs font-semibold text-primary hover:underline">
            {t('all')}
          </Link>
        </div>
      )}
    </div>
  );
}
