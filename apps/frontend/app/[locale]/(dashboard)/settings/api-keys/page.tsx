import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ApiKeysManager, type ApiKeyListItem } from './api-keys-manager';

/**
 * PLACEHOLDER DATA — TODO: replace with a real fetch to `GET /api/v1/api-keys`
 * (`apps/backend/src/api-keys/`) once an authenticated frontend API client
 * exists, same caveat as `settings/channels/page.tsx`'s `MOCK_CHANNEL_LINKS`.
 * Shape mirrors `ApiKeysService.list`'s response exactly (id, name,
 * keyPrefix, lastUsedAt, createdAt, revokedAt) — never the full key or its
 * hash, matching what the real endpoint returns.
 */
const MOCK_API_KEYS: ApiKeyListItem[] = [
  {
    id: '1',
    name: 'Accounting system integration',
    keyPrefix: 'sk_live_ab12',
    lastUsedAt: '2026-09-08T14:32:00.000Z',
    createdAt: '2026-07-01T09:00:00.000Z',
    revokedAt: null
  },
  {
    id: '2',
    name: 'Old Zapier automation',
    keyPrefix: 'sk_live_cd34',
    lastUsedAt: '2026-05-12T08:11:00.000Z',
    createdAt: '2026-03-15T10:00:00.000Z',
    revokedAt: '2026-06-01T00:00:00.000Z'
  }
];

export default async function ApiKeysSettingsPage() {
  const t = await getTranslations('settings.apiKeys');

  return (
    <div>
      <Link href="/settings" className="text-sm text-muted-foreground hover:text-foreground">
        ← {t('back')}
      </Link>

      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="mt-1 text-muted-foreground">{t('description')}</p>

      <ApiKeysManager initialKeys={MOCK_API_KEYS} />
    </div>
  );
}
