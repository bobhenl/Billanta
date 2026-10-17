/** Invite code from `?ref=` (Settings → Invite for credits), kept 30 days until the new company claims it. */
export const REFERRAL_COOKIE = 'billanta_ref';
export const REFERRAL_CODE = /^[A-Za-z0-9]{4,12}$/;

/** Credits per programme; mirrors apps/backend/src/referrals/rewards.ts (1 credit = 1 Kč). */
export const REFERRAL_REWARDS = {
  friend: { welcome: 149, reward: 289 },
  accountant: { welcome: 289, reward: 579 }
} as const;
