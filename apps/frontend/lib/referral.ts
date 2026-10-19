/** Invite code from `?ref=` (Settings → Invite for credits), kept 30 days until the new company claims it. */
export const REFERRAL_COOKIE = 'billanta_ref';
export const REFERRAL_CODE = /^[A-Za-z0-9]{4,12}$/;

/**
 * Credits per programme; mirrors apps/backend/src/referrals/rewards.ts (1 credit = 1 Kč).
 * `reward` is a cap: the referrer gets the referred firm's first payment in Kč,
 * at most this much, once that payment can no longer be undone (copy says "až").
 */
export const REFERRAL_REWARDS = {
  friend: { welcome: 149, reward: 289 },
  // Same as friend on purpose: the accountant tier marks a vetted accountant, not a bigger payout.
  accountant: { welcome: 149, reward: 289 }
} as const;
