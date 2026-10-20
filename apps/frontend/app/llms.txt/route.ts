import { buildLlmsTxt } from '@/lib/llms';

/**
 * llms.txt (https://llmstxt.org): a short plain-text map of the public site
 * for language-model readers, built in lib/llms.ts from the site's own
 * registries and messages.
 */
export const dynamic = 'force-static';

export function GET() {
  return new Response(buildLlmsTxt(), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
