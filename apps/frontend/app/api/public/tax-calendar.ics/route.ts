import { buildIcs, type IcsEvent } from '@faktur/cz-compliance';
import { getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { SITE_URL } from '@/lib/site';
import { calendarFor, isConditional, isoDate, periodText, profileFromParams, profileToParams } from '@/lib/tax-calendar';

/**
 * PUBLIC .ics feed of the tax calendar tool: `?country&entity&vat&extras&lang`,
 * the same profile the page builds. No login and nothing stored: the feed is
 * computed from the query string, for this year and the next, so a
 * subscription rolls into the new year by itself. Calendar apps poll it
 * (REFRESH-INTERVAL 6 h), hence the shared cache.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const lang = params.get('lang') ?? '';
  const locale = (routing.locales as readonly string[]).includes(lang) ? lang : routing.defaultLocale;
  const profile = profileFromParams((k) => params.get(k));
  const t = await getTranslations({ locale, namespace: 'tools.calculators.items.taxCalendar' });
  const year = new Date().getFullYear();
  const page = `${SITE_URL}/${locale}/calculators/tax-calendar?${profileToParams(profile)}`;
  const host = new URL(SITE_URL).host;
  const format = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' });

  const events: IcsEvent[] = [year, year + 1].flatMap((y) =>
    calendarFor(profile, y).map((e) => {
      const moved = e.date.getTime() !== e.statutory.getTime();
      const description = [
        t(`kindHints.${profile.country}.${e.kind}`),
        isConditional(e.kind) ? t(`onlyIf.${e.kind}`) : null,
        moved ? t('moved', { date: format.format(e.statutory) }) : null,
        t('ics.footer')
      ]
        .filter(Boolean)
        .join('\n\n');
      return {
        uid: `${profile.country}-${e.kind}-${isoDate(e.statutory)}@${host}`,
        date: isoDate(e.date),
        summary: `${t(`kinds.${profile.country}.${e.kind}`)} ${periodText((k, v) => t(`period.${k}`, v), locale, e.kind, e.statutory)}`,
        description,
        url: page,
        categories: [t('ics.category')]
      };
    })
  );

  const body = buildIcs(t('ics.name', { country: t(`countries.${profile.country}`) }), events);
  return new Response(body, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename="tax-calendar.ics"',
      'cache-control': 'public, max-age=21600, s-maxage=21600'
    }
  });
}
