/**
 * Module augmentation for Auth.js v5's `Session` type.
 *
 * `auth.ts`'s `callbacks.session` builds the session itself (see the comment
 * there), adding `user.id`, which `lib/api-client.ts` needs to mint a
 * backend JWT (`lib/backend-token.ts`'s `sub` claim), and `twoFactor`:
 * `pending` until the sign-in code is entered, `verified` after, `off` for
 * users without two-factor sign-in.
 */
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
    twoFactor: "pending" | "verified" | "off";
    /** The throwaway user of a /demo company. */
    isDemo: boolean;
  }
}
