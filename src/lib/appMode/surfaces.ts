/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { TAB_ROUTES } from "@/lib/navigation/tabRoutes";
import { FEATURE_FLAG_DEFINITION_BY_ID, type FeatureFlagId } from "@/lib/config/featureFlagsRegistry.generated";
import type { AppMode } from "@/lib/appMode/appModeStore";

export type SurfaceClassification = "always" | "needs-device" | "sid-player-only";

type TabPath = (typeof TAB_ROUTES)[number]["path"];

const ROUTE_CLASSIFICATIONS: Record<TabPath, SurfaceClassification> = {
  "/": "needs-device",
  "/play": "always",
  "/disks": "needs-device",
  "/config": "needs-device",
  "/settings": "always",
  "/docs": "always",
};

const SECTION_CLASSIFICATIONS = {
  "home:quick-actions": "needs-device",
  "home:live-view": "needs-device",
  "home:cpu-ram": "needs-device",
  "home:ports": "needs-device",
  "home:video": "needs-device",
  "home:audio": "needs-device",
  "home:user-interface": "needs-device",
  "home:lighting": "needs-device",
  "home:drives": "needs-device",
  "home:printers": "needs-device",
  "home:streams": "needs-device",
  "home:config-actions": "needs-device",
  "settings:appearance": "always",
  "settings:app-mode": "always",
  "settings:connection": "needs-device",
  "settings:diagnostics": "always",
  "settings:play-and-disk": "always",
  "settings:feature-group-stable": "always",
  "settings:feature-group-experimental": "always",
  "settings:sid-radio": "always",
  "settings:audio-processing": "always",
  "settings:hvsc": "always",
  "settings:online-archive": "always",
  "settings:device-safety": "needs-device",
  "settings:notifications": "always",
  "settings:about": "always",
  "play:spectrum": "always",
  "play:sound": "always",
  "play:hvsc": "always",
  "docs:contents": "always",
  "docs:external-resources": "always",
  "docs:getting-started": "always",
  "docs:play": "always",
  "docs:find-tune": "always",
  "docs:playlist": "always",
  "docs:sid-radio": "always",
  "docs:audio-output": "always",
  "docs:sid-player": "always",
  "docs:keypad": "always",
  "docs:diagnostics": "always",
  "docs:disks": "needs-device",
  "docs:remote-input": "needs-device",
  "docs:game-mode": "needs-device",
  "docs:live-view": "needs-device",
  "docs:config": "needs-device",
  "docs:save-restore": "needs-device",
  "docs:devices": "needs-device",
  "docs:connection-problems": "needs-device",
  "docs:status-badge": "needs-device",
} as const satisfies Record<string, SurfaceClassification>;

const PART_CLASSIFICATIONS = {
  "settings:play-and-disk-machine-rows": "needs-device",
  "play:listening-shortcuts": "sid-player-only",
  "play:c64u-source": "needs-device",
  "play:engine-choice": "needs-device",
  "play:item-config": "needs-device",
  "quick-menu:machine-pause": "needs-device",
  "quick-menu:machine-reset": "needs-device",
  "quick-menu:game-mode": "needs-device",
  "quick-menu:switch-device": "needs-device",
  "quick-menu:stop-live-view": "needs-device",
  "quick-menu:leave-sid-player": "sid-player-only",
  "quick-menu:use-sid-player": "always",
} as const satisfies Record<string, SurfaceClassification>;

export type SectionSurfaceId = keyof typeof SECTION_CLASSIFICATIONS;
export type SurfaceId =
  `route:${TabPath}` | `flag:${FeatureFlagId}` | SectionSurfaceId | keyof typeof PART_CLASSIFICATIONS;

const SECTION_SCOPES_FOLLOWING_THEIR_ROUTE: Record<string, TabPath> = { disks: "/disks", config: "/config" };

const classificationOf = (id: SurfaceId): SurfaceClassification => {
  if (id.startsWith("route:")) return ROUTE_CLASSIFICATIONS[id.slice("route:".length) as TabPath];
  if (id.startsWith("flag:")) {
    const definition = FEATURE_FLAG_DEFINITION_BY_ID[id.slice("flag:".length) as FeatureFlagId];
    return definition.requires_device ? "needs-device" : "always";
  }
  return (
    (SECTION_CLASSIFICATIONS as Record<string, SurfaceClassification>)[id] ??
    (PART_CLASSIFICATIONS as Record<string, SurfaceClassification>)[id]
  );
};

export const isSurfaceVisible = (id: SurfaceId, appMode: AppMode): boolean => {
  const classification = classificationOf(id);
  if (classification === "needs-device") return appMode === "full";
  if (classification === "sid-player-only") return appMode === "sid-player";
  return true;
};

export const isSectionVisible = (scope: string, id: string, appMode: AppMode): boolean => {
  const routePath = SECTION_SCOPES_FOLLOWING_THEIR_ROUTE[scope];
  if (routePath) return isSurfaceVisible(`route:${routePath}`, appMode);
  const key = `${scope}:${id}`;
  if (!(key in SECTION_CLASSIFICATIONS)) return true;
  return isSurfaceVisible(key as SectionSurfaceId, appMode);
};

export const SURFACE_CLASSIFIED_SECTION_IDS: readonly string[] = Object.keys(SECTION_CLASSIFICATIONS);
export const SURFACE_CLASSIFIED_SCOPES_FOLLOWING_ROUTE: readonly string[] = Object.keys(
  SECTION_SCOPES_FOLLOWING_THEIR_ROUTE,
);
