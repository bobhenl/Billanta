import { getTranslations } from 'next-intl/server';
import { Psd2Callback } from './psd2-callback';

export async function generateMetadata() {
  const t = await getTranslations('bank.connections.psd2');
  return { title: t('callbackTitle'), robots: { index: false } };
}

/**
 * `GET /bank/psd2-callback?code=…&state=…` — where the bank sends the user
 * after the PSD2 consent (or `?error=…` when they cancelled). The exchange
 * runs once from the client so a reload can't replay a used code.
 */
export default async function Psd2CallbackPage(
  props: { searchParams: Promise<{ code?: string; state?: string; error?: string }> }
) {
  const searchParams = await props.searchParams;
  return <Psd2Callback code={searchParams.code ?? null} state={searchParams.state ?? null} error={searchParams.error ?? null} />;
}
