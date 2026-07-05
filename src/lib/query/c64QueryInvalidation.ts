/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { QueryClient } from "@tanstack/react-query";
import type { ConnectionState } from "@/lib/connection/connectionManager";

type C64QueryPrefix =
  | "c64-info"
  | "c64-drives"
  | "c64-categories"
  | "c64-category"
  | "c64-config-item"
  | "c64-config-items"
  | "c64-all-config";

const allC64QueryPrefixes: ReadonlyArray<C64QueryPrefix> = [
  "c64-info",
  "c64-drives",
  "c64-categories",
  "c64-category",
  "c64-config-item",
  "c64-config-items",
  "c64-all-config",
];

const routePrefixMap: Array<{
  routePrefix: string;
  prefixes: ReadonlyArray<C64QueryPrefix>;
}> = [
  {
    routePrefix: "/config",
    prefixes: ["c64-info", "c64-categories", "c64-category", "c64-config-item", "c64-config-items", "c64-all-config"],
  },
  {
    routePrefix: "/disks",
    prefixes: ["c64-info", "c64-drives", "c64-config-items"],
  },
  {
    routePrefix: "/play",
    prefixes: ["c64-info", "c64-config-item", "c64-config-items"],
  },
  {
    routePrefix: "/settings",
    prefixes: ["c64-info", "c64-categories"],
  },
  {
    routePrefix: "/docs",
    prefixes: ["c64-info"],
  },
  {
    routePrefix: "/",
    prefixes: ["c64-info", "c64-drives", "c64-config-items"],
  },
];

const savedDeviceSwitchRoutePrefixMap: Array<{
  routePrefix: string;
  prefixes: ReadonlyArray<C64QueryPrefix>;
}> = [
  {
    routePrefix: "/config",
    prefixes: ["c64-info", "c64-categories", "c64-category", "c64-config-item", "c64-config-items"],
  },
  {
    routePrefix: "/disks",
    prefixes: ["c64-info", "c64-drives", "c64-config-items"],
  },
  {
    routePrefix: "/play",
    prefixes: ["c64-info", "c64-config-item", "c64-config-items"],
  },
  {
    routePrefix: "/settings",
    prefixes: ["c64-info", "c64-categories"],
  },
  {
    routePrefix: "/docs",
    prefixes: ["c64-info"],
  },
  {
    routePrefix: "/",
    prefixes: ["c64-info", "c64-drives", "c64-config-items"],
  },
];

const uniquePrefixes = (prefixes: ReadonlyArray<C64QueryPrefix>) => Array.from(new Set(prefixes));
const VISIBILITY_RESUME_THROTTLE_MS = 30_000;
const lastVisibilityResumeInvalidationAtMs = new Map<C64QueryPrefix, number>();

const invalidateByPrefix = (queryClient: QueryClient, prefixes: ReadonlyArray<C64QueryPrefix>) => {
  uniquePrefixes(prefixes).forEach((prefix) => {
    queryClient.invalidateQueries({ queryKey: [prefix] });
  });
};

const refetchActiveByPrefix = (queryClient: QueryClient, prefixes: ReadonlyArray<C64QueryPrefix>) => {
  uniquePrefixes(prefixes).forEach((prefix) => {
    queryClient.refetchQueries({ queryKey: [prefix], type: "active" });
  });
};

export const getRouteInvalidationPrefixes = (pathname: string): ReadonlyArray<C64QueryPrefix> => {
  const normalizedPath = pathname.trim() || "/";
  const matchedEntry = routePrefixMap.find(({ routePrefix }) =>
    routePrefix === "/" ? normalizedPath === "/" : normalizedPath.startsWith(routePrefix),
  );
  return matchedEntry?.prefixes ?? ["c64-info"];
};

export const invalidateForVisibilityResume = (queryClient: QueryClient, pathname: string) => {
  const prefixes = getRouteInvalidationPrefixes(pathname);
  const now = Date.now();
  uniquePrefixes(prefixes).forEach((prefix) => {
    const lastInvalidatedAtMs = lastVisibilityResumeInvalidationAtMs.get(prefix);
    if (
      prefix !== "c64-info" &&
      lastInvalidatedAtMs !== undefined &&
      now - lastInvalidatedAtMs < VISIBILITY_RESUME_THROTTLE_MS
    ) {
      return;
    }
    queryClient.invalidateQueries({ queryKey: [prefix] });
    lastVisibilityResumeInvalidationAtMs.set(prefix, now);
  });
};

/**
 * Prefixes whose in-flight requests the switch CANCELS — route-scoped, because
 * cancellation only needs to abort the queries the current route is actually
 * observing. Invalidation, by contrast, is route-independent (HARD16-009).
 */
export const getSavedDeviceSwitchPrefixes = (pathname: string): ReadonlyArray<C64QueryPrefix> => {
  const normalizedPath = pathname.trim() || "/";
  const matchedEntry = savedDeviceSwitchRoutePrefixMap.find(({ routePrefix }) =>
    routePrefix === "/" ? normalizedPath === "/" : normalizedPath.startsWith(routePrefix),
  );
  return matchedEntry?.prefixes ?? ["c64-info"];
};

/**
 * HARD16-009: a saved-device switch invalidates EVERY device-scoped query
 * regardless of the current route. The old route-scoped list left `c64-drives`
 * (which carries neither device identity nor routing epoch in its key) fresh
 * with device A's payload after switching from `/play`. Invalidation only marks
 * queries stale — inactive ones refetch when next observed, so the cost is bounded.
 */
export const invalidateForSavedDeviceSwitch = (queryClient: QueryClient) => {
  invalidateByPrefix(queryClient, allC64QueryPrefixes);
  refetchActiveByPrefix(queryClient, allC64QueryPrefixes);
};

export const invalidateForConnectionSettingsChange = (queryClient: QueryClient) => {
  invalidateByPrefix(queryClient, allC64QueryPrefixes);
};

export const invalidateForConnectionStateTransition = (
  queryClient: QueryClient,
  previousState: ConnectionState | null,
  nextState: ConnectionState,
) => {
  if (nextState === "REAL_CONNECTED" && previousState !== "REAL_CONNECTED") {
    invalidateByPrefix(queryClient, ["c64-info"]);
    return;
  }
  if (previousState === "REAL_CONNECTED" && nextState !== "REAL_CONNECTED") {
    invalidateByPrefix(queryClient, ["c64-info"]);
  }
};

export const resetVisibilityResumeInvalidationLedgerForTest = () => {
  lastVisibilityResumeInvalidationAtMs.clear();
};
