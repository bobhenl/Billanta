import type { AbstractIntlMessages } from 'next-intl';
import { FULL_LOCALES, type AppLocale } from './locales';

type Messages = AbstractIntlMessages;

const cache = new Map<string, Promise<Messages>>();

function isObject(value: unknown): value is Messages {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `over` wins key by key; nested objects merge, arrays and strings replace. */
function deepMerge(base: Messages, over: Messages): Messages {
  const out: Messages = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const prev = out[key];
    out[key] = isObject(prev) && isObject(value) ? deepMerge(prev, value) : value;
  }
  return out;
}

async function load(locale: AppLocale): Promise<Messages> {
  if ((FULL_LOCALES as readonly string[]).includes(locale)) {
    return (await import(`../messages/${locale}.json`)).default as Messages;
  }
  const en = (await import('../messages/en.json')).default as unknown as Messages;
  try {
    // Webpack bundles every messages/*.json it finds at build time; a file
    // that is not there yet rejects here, and the locale renders in English.
    const own = (await import(`../messages/${locale}.json`)).default as Messages;
    return deepMerge(en, own);
  } catch {
    return en;
  }
}

/**
 * The message catalog of `locale`. cs, sk and en are complete and load as
 * they are. A newer locale (de, pl, uk, hu, ro, fr, es, it, nl, pt) may be translated in part,
 * so its file is merged over en.json and any key it lacks shows in English
 * instead of as a missing-message error.
 */
export function loadMessages(locale: AppLocale): Promise<Messages> {
  let messages = cache.get(locale);
  if (!messages) {
    messages = load(locale);
    cache.set(locale, messages);
  }
  return messages;
}
