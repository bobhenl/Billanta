import { NextResponse } from 'next/server';

// The build this server runs. A tab opened before a deploy compares it with
// its own and offers a reload (components/update-notice.tsx).
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ build: process.env.NEXT_PUBLIC_BUILD_STAMP ?? null }, { headers: { 'Cache-Control': 'no-store' } });
}
