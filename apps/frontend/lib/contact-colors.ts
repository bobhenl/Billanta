/** Customer colour labels — mirrors CONTACT_COLORS in apps/backend/src/contacts/dto/create-contact.dto.ts. */
export const CONTACT_COLORS = ['red', 'orange', 'amber', 'green', 'teal', 'sky', 'indigo', 'violet', 'pink', 'slate'] as const;
export type ContactColor = (typeof CONTACT_COLORS)[number];

/** Literal class names so Tailwind keeps them. */
export const CONTACT_COLOR_DOT: Record<ContactColor, string> = {
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  amber: 'bg-amber-400',
  green: 'bg-green-500',
  teal: 'bg-teal-500',
  sky: 'bg-sky-500',
  indigo: 'bg-indigo-500',
  violet: 'bg-violet-500',
  pink: 'bg-pink-500',
  slate: 'bg-slate-400'
};

export function isContactColor(v: unknown): v is ContactColor {
  return typeof v === 'string' && (CONTACT_COLORS as readonly string[]).includes(v);
}
