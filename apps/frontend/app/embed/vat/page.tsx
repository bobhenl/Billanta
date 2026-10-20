import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { VatCalculator } from '@/components/public-tools/vat-calculator';
import { embedLang } from '@/lib/embeds';
import { cn } from '@/lib/utils';
import { embedTheme, one } from '../embed-frame';

type Search = Record<string, string | string[] | undefined>;
type Messages = { tools: { common: unknown; calculators: { items: { vat: unknown } } } };

/**
 * `/embed/vat?lang=…`: the VAT calculator from /calculators/vat for
 * bloggers' articles. Only the strings it reads go to the browser.
 */
export default async function EmbedVatPage({ searchParams }: { searchParams: Promise<Search> }) {
  const q = await searchParams;
  const lang = embedLang(one(q.lang));
  const theme = embedTheme(q.theme);
  const t = await getTranslations({ locale: lang, namespace: 'embeds.vat' });
  const all = (await getMessages({ locale: lang })) as unknown as Messages;
  const messages = { tools: { common: all.tools.common, calculators: { items: { vat: all.tools.calculators.items.vat } } } };

  return (
    <div lang={lang} className={cn(theme === 'dark' && 'dark')}>
      <div className="text-foreground">
        <h1 className="mb-3 text-base font-bold">{t('frameTitle')}</h1>
        <NextIntlClientProvider locale={lang} messages={messages} timeZone="Europe/Prague">
          <VatCalculator defaultCountry={lang === 'sk' ? 'SK' : 'CZ'} />
        </NextIntlClientProvider>
      </div>
    </div>
  );
}
