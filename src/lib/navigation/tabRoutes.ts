/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { GuardedNavigate } from "@/lib/navigation/navigationGuards";
import { requestPageReset } from "@/lib/navigation/pageReset";
import { getAppMode, type AppMode } from "@/lib/appMode/appModeStore";
import { isSurfaceVisible } from "@/lib/appMode/surfaces";
import { toast } from "@/hooks/use-toast";

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

export const ALL_TAB_INDEXES: readonly number[] = TAB_ROUTES.map((_, index) => index);

/** The indices of the tabs the app mode shows, in tab order. Indices stay identities; only the set shrinks. */
export const visibleTabIndexes = (appMode: AppMode): readonly number[] =>
  ALL_TAB_INDEXES.filter((index) => isSurfaceVisible(`route:${TAB_ROUTES[index].path}`, appMode));

/** Whether the 1-based digit names a tab that is visible in the current app mode. */
export const digitOpensTab = (digit: number): boolean => digit <= visibleTabIndexes(getAppMode()).length;

export const isTabPathVisible = (pathname: string, appMode: AppMode): boolean => {
  const index = tabIndexForPath(pathname);
  return index === -1 || visibleTabIndexes(appMode).includes(index);
};

/** Returns the index for a given pathname, or -1 if not a tab route. */
export const tabIndexForPath = (pathname: string): number => {
  if (pathname === "/diagnostics" || pathname.startsWith("/diagnostics/")) {
    return TAB_ROUTES.findIndex((route) => route.path === "/settings");
  }
  const exact = TAB_ROUTES.findIndex((t) => t.path === pathname);
  if (exact !== -1) return exact;
  // Prefix match for sub-routes (e.g. /settings/open-source-licenses → Settings slot)
  return TAB_ROUTES.findIndex((t) => t.path !== "/" && pathname.startsWith(t.path + "/"));
};

/**
 * Returns the target tab index when navigating from `fromIndex` within the visible tabs.
 * direction === 1  → next page (swipe left)
 * direction === -1 → previous page (swipe right)
 * Wraps around at both ends of the visible set.
 */
export const resolveSwipeTarget = (
  fromIndex: number,
  direction: 1 | -1,
  visible: readonly number[] = ALL_TAB_INDEXES,
): number => {
  const set = visible.includes(fromIndex) ? visible : ALL_TAB_INDEXES;
  const position = set.indexOf(fromIndex);
  return set[(position + direction + set.length) % set.length];
};

let tabHintShown = false;

export const resetTabJumpHintForTests = (): void => {
  tabHintShown = false;
};

/**
 * The keypad's tab jump: digit n opens the n-th visible tab. A digit past the visible tabs says where the
 * pages are, once per session. A factory so the test drives this wiring and not a copy of it, and so
 * the jump reaches the guards through the caller's `GuardedNavigate` (HARD27-022).
 */
export const createTabJumpShortcut =
  (navigate: GuardedNavigate) =>
  (digitIndex: number): void => {
    const visible = visibleTabIndexes(getAppMode());
    const index = visible[digitIndex];
    if (index === undefined) {
      if (visible.length < TAB_ROUTES.length && !tabHintShown) {
        tabHintShown = true;
        toast({ title: `Pages are on keys 1 to ${visible.length}`, alwaysVisible: true, informational: true });
      }
      return;
    }
    if (tabIndexForPath(window.location.pathname) === index) requestPageReset(index);
    navigate(TAB_ROUTES[index].path);
  };
