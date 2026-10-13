import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { routing } from './routing';

/**
 * Resolves the active locale for a request and loads its message catalog.
 * Wired into next.config.mjs via the next-intl plugin.
 *
 * Locale resolution today is purely path-based (middleware.ts). Per
 * blueprint §7, once auth exists this is where a signed-in tenant's
 * `tenants.default_locale` would take precedence over the URL/browser
 * `Accept-Language` default — left as a TODO until the backend/session
 * layer lands.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default
  };
});
