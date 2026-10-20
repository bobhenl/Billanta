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
 * the same app), the `jwt` callback creates the database session row via
 * the SAME adapter `DrizzleAdapter` uses internally, and `jwt.encode`
 * returns that row's token, so the cookie Auth.js writes for a Credentials
 * sign-in is the database session token. (An earlier version set the
 * cookie by hand in the `signIn` callback; Auth.js then overwrote it with
 * its own JWT under the same cookie name, so password sign-in never
 * produced a readable session.) Revisit if a future Auth.js release adds
 * first-class support for this combination.
 */
import { createHash, randomUUID } from "node:crypto";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import { encode as defaultEncode } from "next-auth/jwt";
import { cookies } from "next/headers";
import Credentials from "next-auth/providers/credentials";
import type { Provider } from "next-auth/providers";
import Apple from "next-auth/providers/apple";
import Discord from "next-auth/providers/discord";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { ATTRIBUTION_COOKIE, signupAttributionColumns } from "./lib/attribution";
import * as authSchema from "./lib/auth-schema";
import { clientIp } from "./lib/client-ip";
import { db } from "./lib/db";
import { AUTH_LIMITS, allow, resetTokens } from "./lib/rate-limit";

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days — Auth.js's own default.

const drizzleAdapter = DrizzleAdapter(db, {
  usersTable: authSchema.users,
  accountsTable: authSchema.accounts,
  sessionsTable: authSchema.sessions,
  verificationTokensTable: authSchema.verificationTokens,
});

/** What the `sessions` table stores instead of the cookie value. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Only a SHA-256 of each session token reaches the database; the raw value
 * lives in the user's cookie alone. A leaked copy of the database (the
 * BitFaktura incident: "identifikátory sessions" were among the copied
 * data) then cannot be replayed as a cookie to take over a signed-in
 * account. The tokens are random UUIDs, so a fast hash is enough (same
 * reasoning as `api-key.util.ts` in the backend). Auth.js keeps working
 * with the raw token: every session method hashes on the way in and hands
 * the raw value back on the way out.
 */
const adapter: typeof drizzleAdapter = {
  ...drizzleAdapter,
  // Every way in (password and OAuth alike) ends here, so this is where a
  // user with two-factor sign-in gets a session that still waits for a code.
  async createSession(session) {
    const [owner] = await db
      .select({ totpEnabledAt: authSchema.users.totpEnabledAt })
      .from(authSchema.users)
      .where(eq(authSchema.users.id, session.userId))
      .limit(1);
    const created = await drizzleAdapter.createSession!({
      ...session,
      sessionToken: hashSessionToken(session.sessionToken),
      twoFactorPending: Boolean(owner?.totpEnabledAt),
    } as typeof session);
    return { ...created, sessionToken: session.sessionToken };
  },
  async getSessionAndUser(sessionToken) {
    const found = await drizzleAdapter.getSessionAndUser!(hashSessionToken(sessionToken));
    return found ? { ...found, session: { ...found.session, sessionToken } } : null;
  },
  async updateSession(session) {
    const hashed = hashSessionToken(session.sessionToken);
    // Auth.js slides every session forward by maxAge. A demo or student
    // session keeps the end it was opened with (lib/demo-session.ts), so a
    // shared school computer doesn't stay signed in to a pupil's company.
    if (session.expires) {
      const found = await drizzleAdapter.getSessionAndUser!(hashed);
      if ((found?.user as { isDemo?: boolean } | undefined)?.isDemo) return { ...found!.session, sessionToken: session.sessionToken };
    }
    const updated = await drizzleAdapter.updateSession!({ ...session, sessionToken: hashed });
    return updated ? { ...updated, sessionToken: session.sessionToken } : updated;
  },
  async deleteSession(sessionToken) {
    await drizzleAdapter.deleteSession!(hashSessionToken(sessionToken));
  },
  // A first social sign-in creates the account here: keep where the
  // visitor first came from (lib/attribution.ts), as the signup route does.
  async createUser(user) {
    let attribution: ReturnType<typeof signupAttributionColumns> = { signupAttribution: null, signupSource: null };
    try {
      attribution = signupAttributionColumns((await cookies()).get(ATTRIBUTION_COOKIE)?.value);
    } catch {
      // Outside a request (no cookies to read): created without it.
    }
    const created = await drizzleAdapter.createUser!(user);
    if (attribution.signupSource || attribution.signupAttribution) {
      await db.update(authSchema.users).set(attribution).where(eq(authSchema.users.id, created.id));
    }
    return created;
  },
  // Social sign-in only proves who the user is; nothing ever calls Google,
  // GitHub & co. on their behalf (Drive backups run their own, encrypted
  // OAuth flow). So the provider's access/refresh/id tokens are not stored
  // at all: a leaked `accounts` table then holds nothing to act with.
  async linkAccount(account) {
    await drizzleAdapter.linkAccount!({
      ...account,
      access_token: undefined,
      refresh_token: undefined,
      id_token: undefined,
      session_state: undefined,
    });
  },
};

const SESSION_COOKIES = ["__Secure-authjs.session-token", "authjs.session-token"] as const;

/** The cookie Auth.js uses for the session on this request's scheme. */
export function sessionCookieName(secure: boolean): string {
  return secure ? SESSION_COOKIES[0] : SESSION_COOKIES[1];
}

/**
 * Opens a session for the password-less demo user `create_demo_tenant` made
 * (app/api/demo/start). Goes through the wrapped adapter, so only the hash
 * is stored, like any other sign-in. Returns the raw token for the cookie.
 */
export async function createDemoSession(userId: string, expires: Date): Promise<string> {
  const sessionToken = randomUUID();
  await adapter.createSession!({ sessionToken, userId, expires });
  return sessionToken;
}

export async function deleteSessionByToken(sessionToken: string): Promise<void> {
  await adapter.deleteSession!(sessionToken);
}

/** Whether the browser's current session belongs to a demo user. */
async function currentSessionIsDemo(): Promise<boolean> {
  const jar = await cookies();
  const token = SESSION_COOKIES.map((name) => jar.get(name)?.value).find(Boolean);
  if (!token) return false;
  const found = await adapter.getSessionAndUser!(token);
  return Boolean((found?.user as { isDemo?: boolean } | undefined)?.isDemo);
}

/**
 * Social sign-in. Every provider is always REGISTERED, but the login page
 * only draws a button for those whose credentials are set
 * (lib/oauth-providers.ts), so a missing key hides the button rather than
 * leaving one that fails.
 *
 * Registering them unconditionally is load-bearing: Auth.js refuses a config
 * whose only provider is Credentials while `session.strategy` is
 * "database" (UnsupportedStrategy in @auth/core's assertConfig). With no
 * OAuth keys in a local .env, conditional registration would leave exactly
 * that config and break email/password sign-in.
 *
 * Linking by email stays at Auth.js's safe default (off): an OAuth sign-in
 * whose email already has a password account is refused, not merged.
 */
function oauthProviders(): Provider[] {
  const env = process.env;
  return [
    Google({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }),
    // "common" tenant: any work/school (Microsoft 365) or personal Microsoft account.
    MicrosoftEntraID({
      clientId: env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
      issuer: env.MICROSOFT_ISSUER ?? "https://login.microsoftonline.com/common/v2.0",
    }),
    Apple({ clientId: env.APPLE_CLIENT_ID, clientSecret: env.APPLE_CLIENT_SECRET }),
    seznam(env.SEZNAM_CLIENT_ID ?? "", env.SEZNAM_CLIENT_SECRET ?? ""),
    Discord({ clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET }),
    GitHub({ clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }),
  ];
}

/**
 * "Přihlásit se přes Seznam" — Seznam.cz's OAuth 2.0 (not built into
 * Auth.js). Endpoints and profile fields per Seznam's developer docs
 * (vyvojari.seznam.cz, "Přihlášení přes Seznam"); the `identity` scope
 * returns the account email and name. Verify against the docs when
 * registering the app, as they are not covered by an Auth.js test suite.
 */
function seznam(clientId: string, clientSecret: string): Provider {
  return {
    id: "seznam",
    name: "Seznam",
    type: "oauth",
    clientId,
    clientSecret,
    authorization: { url: "https://login.szn.cz/api/v1/oauth/auth", params: { scope: "identity" } },
    token: "https://login.szn.cz/api/v1/oauth/token",
    userinfo: "https://login.szn.cz/api/v1/user",
    checks: ["state"],
    profile(profile: { oauth_user_id: string; email?: string; firstname?: string; lastname?: string; avatar_url?: string }) {
      return {
        id: profile.oauth_user_id,
        email: profile.email,
        name: [profile.firstname, profile.lastname].filter(Boolean).join(" ") || null,
        image: profile.avatar_url ?? null,
      };
    },
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter,
  session: { strategy: "database", maxAge: SESSION_MAX_AGE_SECONDS },
  jwt: {
    // Only reached on a Credentials sign-in (the database strategy never
    // encodes JWTs otherwise): the cookie value becomes the database
    // session token the `jwt` callback just created.
    async encode(params) {
      const sessionToken = params.token?.sessionToken;
      return typeof sessionToken === "string" ? sessionToken : defaultEncode(params);
    },
  },
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const email = typeof credentials?.email === "string" ? credentials.email.trim().toLowerCase() : undefined;
        const password = typeof credentials?.password === "string" ? credentials.password : undefined;
        if (!email || !password) return null;

        // Brute-force brake: per address and per account. A blocked attempt
        // looks like a wrong password, so it reveals nothing either.
        const ip = request instanceof Request ? clientIp(request) : "";
        if (ip && !allow(`login:ip:${ip}`, AUTH_LIMITS.loginPerIp)) return null;
        if (!allow(`login:email:${email}`, AUTH_LIMITS.loginPerEmail)) return null;

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
        resetTokens(`login:email:${email}`);

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          image: user.image ?? undefined,
        };
      },
    }),
    ...oauthProviders(),
  ],
  callbacks: {
    // Builds the session from scratch rather than returning what Auth.js
    // passes in: that object is the whole `sessions` row (raw session token
    // included) plus the whole `users` row (password hash, TOTP secret), and
    // whatever this returns is also served to the browser by
    // `/api/auth/session`. `user.id` is needed to mint the backend JWT
    // (`lib/backend-token.ts`); `twoFactor` drives the code prompt. See
    // `types/next-auth.d.ts` for the matching type augmentation.
    session({ session, user }) {
      const row = session as unknown as { twoFactorPending?: boolean; twoFactorAt?: Date | null };
      const fullUser = user as typeof user & { totpEnabledAt?: Date | null; isDemo?: boolean; isTeacher?: boolean; managesClients?: boolean };
      const twoFactor = row.twoFactorPending ? "pending" : fullUser.totpEnabledAt && row.twoFactorAt ? "verified" : "off";
      return {
        user: { id: user.id, name: user.name ?? null, email: user.email, image: user.image ?? null },
        expires: session.expires.toISOString?.() ?? session.expires,
        twoFactor,
        isDemo: fullUser.isDemo === true,
        isTeacher: fullUser.isTeacher === true,
        managesClients: fullUser.managesClients === true,
      } as typeof session;
    },
    // With database sessions, an OAuth sign-in while signed in LINKS the
    // provider to the current user. From a demo that would tie a real Google
    // account to a user the cleanup is about to delete, so refuse it.
    async signIn({ account }) {
      if (account && account.provider !== "credentials" && (await currentSessionIsDemo())) return false;
      return true;
    },
    // See this file's top-of-file doc comment. For a Credentials sign-in
    // Auth.js runs this callback and then writes `jwt.encode(token)` into
    // the session cookie; creating the database session here and handing
    // its token to `encode` below makes that cookie a real, revocable
    // database session instead of a JWT the database strategy can't read.
    async jwt({ token, user, account }) {
      if (account?.provider === "credentials" && user?.id && adapter.createSession) {
        const sessionToken = randomUUID();
        const expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
        await adapter.createSession({ sessionToken, userId: user.id, expires });
        token.sessionToken = sessionToken;
      }
      return token;
    },
  },
});
