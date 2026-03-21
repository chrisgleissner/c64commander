/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Authoritative ordered list of primary tab routes.
 * Swipe navigation and TabBar both derive their page order from this constant.
 * Order: Home → Play → Disks → Config → Settings → Docs
 */
export const TAB_ROUTES = [
  { path: "/", label: "Home" },
  { path: "/play", label: "Play" },
  { path: "/disks", label: "Disks" },
  { path: "/config", label: "Config" },
  { path: "/settings", label: "Settings" },
  { path: "/docs", label: "Docs" },
] as const;

export type TabRoute = (typeof TAB_ROUTES)[number];

/** Returns the index for a given pathname, or -1 if not a tab route. */
export const tabIndexForPath = (pathname: string): number => {
  const exact = TAB_ROUTES.findIndex((t) => t.path === pathname);
  if (exact !== -1) return exact;
  // Prefix match for sub-routes (e.g. /settings/open-source-licenses → Settings slot)
  return TAB_ROUTES.findIndex((t) => t.path !== "/" && pathname.startsWith(t.path + "/"));
};

/**
 * Returns the target tab index when navigating from `fromIndex`.
 * direction === 1  → next page (swipe left)
 * direction === -1 → previous page (swipe right)
 * Wraps around at both ends.
 */
export const resolveSwipeTarget = (fromIndex: number, direction: 1 | -1): number => {
  const count = TAB_ROUTES.length;
  return (fromIndex + direction + count) % count;
};
