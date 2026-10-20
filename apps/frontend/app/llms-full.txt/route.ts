import { buildLlmsFullTxt } from '@/lib/llms';

/** The long llms.txt: feature details, the plan table and the FAQs in every language (lib/llms.ts). */
export const dynamic = 'force-static';

export function GET() {
  return new Response(buildLlmsFullTxt(), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
