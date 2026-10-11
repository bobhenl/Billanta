/**
 * NextAuth v5 (Auth.js) configuration — blueprint §2: "Auth.js (NextAuth
 * v5), Credentials + Google OAuth, Postgres session store." Discord is
 * added alongside Google per this task's brief.
 *
 * `session: { strategy: "database" }` per the blueprint's explicit choice
 * (server-revocable sessions via `sessions` table, not stateless JWTs for
 * the dashboard's own login state — NOT to be confused with the separate
 * short-lived backend JWT minted by `lib/backend-token.ts` for calling the
 * NestJS API).
 *
 * ============================================================================
 * KNOWN AUTH.JS LIMITATION — Credentials + database sessions — read before
 * touching the `signIn` callback below.
 * ============================================================================
 * Auth.js's database session strategy is designed around its own OAuth
 * callback flow: when an OAuth provider signs a user in, Auth.js's internal
 * flow creates the `accounts` row AND a `sessions` row together via the
 * adapter, then sets the session cookie. The Credentials provider has no
 * equivalent — `authorize()` just returns a plain user object with no OAuth
 * account to hang a session off, so Auth.js does NOT create a database
 * session for a successful Credentials sign-in on its own. (This is why
 * Auth.js's docs generally pair Credentials with `session.strategy: "jwt"`
 * instead.)
 *
 * Rather than splitting Credentials onto a separate JWT-session code path
 * (which would leave two different, inconsistent notions of "session" in
 * the same app), this config manually creates the database session row -
 * via the SAME adapter `DrizzleAdapter` uses internally - in the `signIn`
 * callback, and sets the session cookie by hand using Auth.js v5's cookie
 * naming convention. This is a deliberate, documented workaround for a real
 * gap in Auth.js, not an oversight — revisit if a future Auth.js release
 * adds first-class support for this combination.
 */
import { randomUUID } from "node:crypto";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Discord from "next-auth/providers/discord";
import Google from "next-auth/providers/google";
import * as authSchema from "./lib/auth-schema";
import { db } from "./lib/db";

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days — Auth.js's own default.

const adapter = DrizzleAdapter(db, {
  usersTable: authSchema.users,
  accountsTable: authSchema.accounts,
  sessionsTable: authSchema.sessions,
  verificationTokensTable: authSchema.verificationTokens,
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter,
  session: { strategy: "database", maxAge: SESSION_MAX_AGE_SECONDS },
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = typeof credentials?.email === "string" ? credentials.email.trim().toLowerCase() : undefined;
        const password = typeof credentials?.password === "string" ? credentials.password : undefined;
        if (!email || !password) return null;

        const [user] = await db
          .select()
          .from(authSchema.users)
          .where(eq(authSchema.users.email, email))
          .limit(1);

        // No local password hash means this identity only ever signed up
        // via an OAuth provider (Google/Discord) — never compare against a
        // null/undefined hash, reject outright instead.
        if (!user?.passwordHash) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          image: user.image ?? undefined,
        };
      },
    }),
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    // See this file's top-of-file doc comment for why this exists.
    async signIn({ user, account }) {
      if (account?.provider !== "credentials" || !user.id || !adapter.createSession) {
        return true;
      }

      const sessionToken = randomUUID();
      const expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
      await adapter.createSession({ sessionToken, userId: user.id, expires });

      // Auth.js v5's default cookie names (see its `cookies.ts`): the
      // `__Secure-` prefix is required by browsers on cookies marked
      // `secure`, and Auth.js only marks the session cookie `secure` when
      // served over HTTPS.
      const secureCookie = (process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? "").startsWith("https://");
      const cookieName = secureCookie ? "__Secure-authjs.session-token" : "authjs.session-token";

      const { cookies } = await import("next/headers");
      const cookieStore = await cookies();
      cookieStore.set(cookieName, sessionToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: secureCookie,
        expires,
        path: "/",
      });

      return true;
    },
  },
});
