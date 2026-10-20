// Kept apart from lib/admin-blog.ts, which pulls in the server-only API
// client: the admin blog's client component needs these lists too.

/** Generated kinds that may publish on their own; briefs, tax deadlines and hand-written posts always wait for a click. */
export const AUTO_PUBLISH_KINDS = ['tool_howto', 'trade_invoicing'] as const;
export type AutoPublishKind = (typeof AUTO_PUBLISH_KINDS)[number];

/** Kinds the "next topic" generator writes, in cs and sk. */
export const TOPIC_KINDS = ['tool_howto', 'trade_invoicing'] as const;
export type TopicKind = (typeof TOPIC_KINDS)[number];
