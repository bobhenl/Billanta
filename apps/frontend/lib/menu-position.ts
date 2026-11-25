/** Where a row's "⋯" menu opens, relative to the viewport (the menu is `position: fixed`). */
export type MenuPosition = { top?: number; bottom?: number; right: number; maxHeight: number };

/**
 * Opens below the button, or above it when the menu doesn't fit below and
 * there is more room above. The height comes from the item count (each item is
 * 36 px, plus padding), so a short menu near the bottom still opens downward.
 * Flipped menus are anchored by their bottom edge to the button.
 */
export function menuPosition(rect: DOMRect, items: number): MenuPosition {
  const height = items * 36 + 16;
  const right = window.innerWidth - rect.right;
  const below = window.innerHeight - rect.bottom - 12;
  const above = rect.top - 12;
  if (below >= height || below >= above) return { top: rect.bottom + 4, right, maxHeight: below };
  return { bottom: window.innerHeight - rect.top + 4, right, maxHeight: above };
}
