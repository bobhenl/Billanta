/**
 * Which social sign-in buttons exist. A provider is offered only when its
 * credentials are configured, so a missing key hides the button instead of
 * leaving one that fails on click. Used by the login page (auth.ts registers
 * every provider regardless — see the comment on oauthProviders() there).
 */
export const OAUTH_PROVIDERS = [
  { id: 'google', env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] },
  { id: 'microsoft-entra-id', env: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'] },
  { id: 'apple', env: ['APPLE_CLIENT_ID', 'APPLE_CLIENT_SECRET'] },
  { id: 'seznam', env: ['SEZNAM_CLIENT_ID', 'SEZNAM_CLIENT_SECRET'] },
  { id: 'discord', env: ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET'] },
  { id: 'github', env: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'] }
] as const;

export type OAuthProviderId = (typeof OAUTH_PROVIDERS)[number]['id'];

export function isOAuthProviderEnabled(id: OAuthProviderId): boolean {
  const provider = OAUTH_PROVIDERS.find((p) => p.id === id);
  return Boolean(provider?.env.every((key) => process.env[key]?.trim()));
}

export function enabledOAuthProviders(): OAuthProviderId[] {
  return OAUTH_PROVIDERS.filter((p) => isOAuthProviderEnabled(p.id)).map((p) => p.id);
}
