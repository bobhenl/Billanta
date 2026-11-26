# UX readability pass – shared brief

Goal: go over the pages in your area and make them simpler to read and nicer to use, without
making them look AI-generated or generic. The user's words: too many chips in places, inputs
that are not aligned, too much text so people will not want to read it. Live preview and
animation only where they genuinely help (steps, flows), never as decoration.

Reference for the tone: the homepage was just simplified (`apps/frontend/app/[locale]/(marketing)/page.tsx`):
six aligned tiles with visible text instead of 21 chips and a collapsing hint, no extra pills,
a four-column comparison instead of six, shorter headings.

What to look for
- Walls of text: cut it, keep one idea per paragraph, move detail behind a link or a disclosure.
- Chip/tag/badge clutter, pill rows, repeated icon-in-circle cards. Prefer fewer, bigger, aligned items.
- Misaligned form fields and labels, inconsistent widths, heights, spacing, radii.
- Mobile (375 px): no horizontal scroll, tap targets, tables that need a card layout.
- Dark mode contrast, empty states, loading states, obviously broken or placeholder text.
- Generic AI look: gradient blobs everywhere, emoji, "supercharge", three identical feature cards, stacked
  badges. Replace with concrete, specific, plain wording and layout.

Rules (from AGENTS.md, they apply)
- Every user-facing string goes into all three locales cs, sk, en (`apps/frontend/messages/*.json`).
  Czech is primary. Write Slovak as real Slovak. Never use the long em dash; use the en dash with spaces.
- Edit the JSON files with small targeted edits (exact-string replace). Do NOT reformat or rewrite whole
  files: other agents edit the same files at the same time. Keep key order and line endings.
- Stay inside your own area (files listed in your task). If you need a shared component, make a small
  backwards-compatible change and mention it in your report.
- Match surrounding code style. Comments explain why, not what.
- Do not commit, push, stash, reset or touch git state. Do not run `pnpm install`. Do not start extra dev
  servers: the frontend runs on http://localhost:3100 and the backend on :3000 (both with hot reload).
- Never print or repeat credentials. Dev login credentials are in the gitignored `.env.dev-login`
  at the repo root; read it only to sign in to the local app. Do not send real emails.
- AI never issues invoices. Do not weaken tenant isolation.
- Verify in the browser tools (mcp__Claude_Browser__*, tab of your own: tabs_create) at desktop and 375 px
  (resize_window, then reset to desktop). Check the console for errors.
- Before finishing run `pnpm --filter @faktur/frontend typecheck` (the shared tree may have errors from
  other agents' in-progress edits; only fix yours).

Report back (short, Czech is fine): what you changed per page, what you deliberately left, anything
that needs a decision. Do not paste long diffs.

## Update from the user (applies to everyone)

- Priority is simplicity and accuracy: people should get what they came for fast. Cut filler, marketing
  fluff and repeated claims. Keep concrete facts (prices, limits, what it does). One clear action per section.
- Animation: only small, purposeful motion like the homepage hero slides (a step, a state change, a live
  preview). No decorative motion. Respect prefers-reduced-motion.
- The (i) hint components (components/info-hint.tsx, components/hint-card.tsx) are being reworked by a
  separate agent (hover tooltip on desktop, slide-open on touch). Do NOT edit those two files or `.hint-btn`
  CSS. Keep using them; you may drop a hint where the text is unnecessary or show short text inline.
