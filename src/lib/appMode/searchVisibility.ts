/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { AppMode } from "@/lib/appMode/appModeStore";
import { isSectionVisible, isSurfaceVisible, type SurfaceId } from "@/lib/appMode/surfaces";
import { isTabPathVisible } from "@/lib/navigation/tabRoutes";
import { FEATURE_FLAG_DEFINITION_BY_ID, isKnownFeatureFlagId } from "@/lib/config/featureFlags";
import type { SearchEntry, SearchRequirement, SearchTarget } from "@/lib/search/types";

const requirementNeedsDevice = (requirement: SearchRequirement): boolean => {
  switch (requirement.kind) {
    case "device":
    case "capability":
    case "productFamily":
    case "telnet":
      return true;
    case "flag":
      return isKnownFeatureFlagId(requirement.flag) && FEATURE_FLAG_DEFINITION_BY_ID[requirement.flag].requires_device;
    default:
      return false;
  }
};

const targetVisible = (target: SearchTarget, appMode: AppMode): boolean => {
  switch (target.kind) {
    case "route":
      return isTabPathVisible(target.path, appMode);
    case "section":
      return isTabPathVisible(target.path, appMode) && isSectionVisible(target.scope, target.id, appMode);
    case "control":
      return isTabPathVisible(target.path, appMode) && isSectionVisible(target.scope, target.sectionId, appMode);
    case "configItem":
      return isSurfaceVisible("route:/config" satisfies SurfaceId, appMode);
    case "action":
      return true;
  }
};

/** A search entry that needs a device, or leads to a place the mode hides, is not offered at all. */
export const isSearchEntryShown = (entry: SearchEntry, appMode: AppMode): boolean =>
  appMode === "full" || (!(entry.requires ?? []).some(requirementNeedsDevice) && targetVisible(entry.target, appMode));
