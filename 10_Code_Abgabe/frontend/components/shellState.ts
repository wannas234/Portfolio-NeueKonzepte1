// Pure state rules of the app shell (sidebar/drawer), kept free of React so they are
// deterministic and testable.
//
// Two independent pieces of state exist:
//  - `collapsed`: the desktop preference (expanded or icon-only sidebar), persisted.
//  - the mobile drawer: NOT persisted. It is stored as the path it was opened on
//    (`openedAt`), so a route change closes it without any effect or extra state.
//
// Below the compact breakpoint the sidebar is always an overlay drawer, and the saved
// `collapsed` preference is ignored there (but kept, for when the viewport is wide again).

/** Keep in sync with the `max-width` of the compact rules in dashboardFrame.module.css. */
export const COMPACT_MEDIA_QUERY = "(max-width: 900px)";

/** Whether the desktop sidebar is shown icon-only. Never applies in compact mode. */
export function effectiveCollapsed(collapsed: boolean, compact: boolean): boolean {
  return collapsed && !compact;
}

/** The drawer is open only in compact mode, and only on the path it was opened on. */
export function isDrawerOpen(openedAt: string | null, pathname: string, compact: boolean): boolean {
  return compact && openedAt !== null && openedAt === pathname;
}
