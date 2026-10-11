import { handlers } from "@/auth";

// Standard NextAuth v5 App Router wiring — `middleware.ts`'s matcher already
// excludes `/api/*` from locale-prefix rewriting, so this route lives at the
// bare `/api/auth/...` path Auth.js/OAuth providers expect (no `/:locale`
// prefix), matching the callback URLs configured with Google/Discord.
export const { GET, POST } = handlers;
