/**
 * Module augmentation for Auth.js v5's `Session` type.
 *
 * By default, `@auth/core`'s built-in `session` callback for the database
 * strategy (see `../auth.ts`'s top-of-file doc comment on
 * `session: { strategy: "database" }`) deliberately strips the session down
 * to `{ user: { name, email, image }, expires }` — `user.id` is NOT
 * included unless a custom `session` callback puts it there. `auth.ts` adds
 * exactly that (see its `callbacks.session`), so this augmentation makes
 * the resulting `session.user.id` visible to TypeScript everywhere `auth()`
 * is called — most importantly `lib/api-client.ts`, which needs the raw
 * user id to mint a backend JWT (`lib/backend-token.ts`'s `sub` claim).
 */
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}
