import type { AbstractIntlMessages } from 'next-intl';

/**
 * Which message namespaces go to the browser. `NextIntlClientProvider`
 * serialises whatever it gets into every page's HTML, and the full catalog
 * is about 300 kB per locale, most of it long copy that only server
 * components read (`getTranslations`). Shipping all of it made every public
 * page several hundred kB heavier.
 *
 * These are deny lists on purpose: a new namespace reaches the client by
 * default. When a client component (`useTranslations`) starts using one of
 * the namespaces below, take it off the list.
 */

/** Read only by server components; never sent to the browser. */
const SERVER_ONLY = ['legal', 'featurePages', 'municipalityPages', 'comparePage', 'pricing', 'accountants', 'about', 'partnerSegments', 'learnPages', 'embeds', 'paymentReminders'];

/** Used only by client components of the signed-in app; the dashboard layout adds them. */
const DASHBOARD_ONLY = [
  'settings',
  'doc',
  'invoiceForm',
  'bank',
  'contacts',
  'dashboard',
  'invoices',
  'expenses',
  'reports',
  'palette',
  'time',
  'templates',
  'bulk',
  'glossary',
  'welcome',
  'invite',
  'offline',
  'promo',
  'adminPromoCodes'
];

function omit(messages: AbstractIntlMessages, namespaces: string[]): AbstractIntlMessages {
  const out = { ...messages };
  for (const ns of namespaces) delete out[ns];
  return out;
}

/** For the root layout: public site, auth pages and public token pages. */
export const publicClientMessages = (messages: AbstractIntlMessages) => omit(messages, [...SERVER_ONLY, ...DASHBOARD_ONLY]);

/** For the dashboard layout, which replaces the root provider's messages. */
export const dashboardClientMessages = (messages: AbstractIntlMessages) => omit(messages, SERVER_ONLY);
