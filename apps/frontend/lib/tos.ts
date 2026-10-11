/**
 * The ToS version every new company is created under. Per blueprint §9,
 * each signup (and each extra company, `POST /api/v1/me/tenants`) logs a
 * fresh, timestamped acceptance of this version in `tos_acceptances` —
 * bumping it is how a future "material VOP update" would make new
 * acceptances refer to the current text.
 */
export const TOS_VERSION = '1.0.0';
