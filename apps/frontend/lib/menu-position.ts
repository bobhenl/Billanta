/** Where a row's "⋯" menu opens, relative to the viewport (the menu is `position: fixed`). */
export type MenuPosition = { top?: number; bottom?: number; right: number; maxHeight: number };

/**
 * Opens below the button, or above it when there isn't room for `estimate`
 * pixels below and there is more room above. Flipped menus are anchored by
 * their bottom edge to the button, so the gap stays right whatever the menu's
 * real height is (a guessed height left short menus floating far above).
 */
export function menuPosition(rect: DOMRect, estimate: number): MenuPosition {
  const right = window.innerWidth - rect.right;
  const below = window.innerHeight - rect.bottom - 12;
  const above = rect.top - 12;
  if (below >= estimate || below >= above) return { top: rect.bottom + 4, right, maxHeight: below };
  return { bottom: window.innerHeight - rect.top + 4, right, maxHeight: above };
}
