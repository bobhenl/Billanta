/** One term's text in one language (see lib/glossary.ts for why this is not in messages/). */
export interface GlossaryText {
  /** Headword as the page title and link label shows it. */
  term: string;
  /** Abbreviation or other names, shown under the headword. */
  aka?: string;
  /** One or two sentences that make sense on their own (quoted by search and AI assistants). */
  definition: string;
  /** A few short paragraphs. */
  explanation: string[];
  example: string;
  /**
   * Regex sources (case-insensitive, Unicode) of the forms the term appears
   * in running text, for linking it from guides and calculators. Omit when
   * the headword is too generic to link safely.
   */
  match?: string[];
}

export type GlossaryTexts = Record<string, GlossaryText>;
