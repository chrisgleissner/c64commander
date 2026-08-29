/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { FEATURE_FLAG_DEFINITION_BY_ID, isKnownFeatureFlagId } from "@/lib/config/featureFlags";
import type { DeviceCapabilities } from "@/lib/deviceCapabilities";
import type {
  DeviceCapabilityKey,
  RequirementVerdict,
  ResolvedSearchEntry,
  SearchEntry,
  SearchRequirement,
  SearchTarget,
} from "@/lib/search/types";

/**
 * Everything a requirement can be evaluated against. Assembled once per query from live app state
 * (spec.md section 5.3): the build machine knows none of it, so none of it is in the generated
 * index.
 */
export interface RequirementContext {
  /** The selected device is connected right now. */
  readonly deviceConnected: boolean;
  readonly capabilities: DeviceCapabilities;
  readonly telnetAvailable: boolean;
  /** A named on/off switch the user controls: a feature flag, or an app setting that acts as one. */
  readonly flagValue: (flag: string) => boolean;
  readonly variantId: string;
  readonly hvscReady: boolean;
  readonly hasRestorableSession: boolean;
}

const settingsSection = (id: string): SearchTarget => ({
  kind: "section",
  path: "/settings",
  scope: "settings",
  id,
});

/** Where a user goes to turn a named switch on. Feature flags land on their own chapter. */
const remedyForFlag = (flag: string): SearchTarget => {
  if (isKnownFeatureFlagId(flag)) {
    return settingsSection(`feature-group-${FEATURE_FLAG_DEFINITION_BY_ID[flag].group}`);
  }
  if (flag === "sid_radio_enabled" || flag === "sid_ranking_enabled" || flag === "local_engine_enabled") {
    return settingsSection("sid-radio");
  }
  return settingsSection("feature-group-stable");
};

const flagLabel = (flag: string): string =>
  isKnownFeatureFlagId(flag) ? FEATURE_FLAG_DEFINITION_BY_ID[flag].title : flag.replace(/_/g, " ");

const CAPABILITY_REASONS: Readonly<Record<DeviceCapabilityKey, string>> = {
  restReachable: "This C64 Ultimate is not answering",
  supportsStreaming: "This model cannot stream picture or sound",
  supportsMenuInput: "This model cannot be driven through its menu",
  supportsPowerCycle: "This model cannot be power cycled from the app",
  supportsMachineInput: "This model cannot take keyboard or joystick input from the app",
};

/**
 * One requirement to a verdict. Every member of the union is answered here and nowhere else, which
 * is what `requirements.test.ts` asserts exhaustively — a new kind that is not handled fails the
 * switch's exhaustiveness check at compile time and that test at run time.
 */
export const resolveRequirement = (requirement: SearchRequirement, ctx: RequirementContext): RequirementVerdict => {
  switch (requirement.kind) {
    case "device":
      return ctx.deviceConnected
        ? { met: true, reason: "" }
        : {
            met: false,
            reason: "Needs a connected C64 Ultimate",
            remedyTarget: settingsSection("connection"),
          };
    case "capability":
      if (!ctx.deviceConnected) {
        return {
          met: false,
          reason: "Needs a connected C64 Ultimate",
          remedyTarget: settingsSection("connection"),
        };
      }
      return ctx.capabilities[requirement.capability]
        ? { met: true, reason: "" }
        : { met: false, reason: CAPABILITY_REASONS[requirement.capability] };
    case "productFamily":
      if (!ctx.deviceConnected) {
        return {
          met: false,
          reason: "Needs a connected C64 Ultimate",
          remedyTarget: settingsSection("connection"),
        };
      }
      return requirement.families.includes(ctx.capabilities.family)
        ? { met: true, reason: "" }
        : { met: false, reason: "Not available on this model" };
    case "telnet":
      if (!ctx.deviceConnected) {
        return {
          met: false,
          reason: "Needs a connected C64 Ultimate",
          remedyTarget: settingsSection("connection"),
        };
      }
      return ctx.telnetAvailable
        ? { met: true, reason: "" }
        : {
            met: false,
            reason: "Needs Telnet reachable on your C64 Ultimate",
            remedyTarget: settingsSection("connection"),
          };
    case "flag":
      return ctx.flagValue(requirement.flag)
        ? { met: true, reason: "" }
        : {
            met: false,
            reason: `${flagLabel(requirement.flag)} is turned off in Settings`,
            remedyTarget: remedyForFlag(requirement.flag),
          };
    case "variant":
      return ctx.variantId === requirement.variant
        ? { met: true, reason: "" }
        : { met: false, reason: "Not part of this edition of the app" };
    case "hvsc":
      return ctx.hvscReady
        ? { met: true, reason: "" }
        : {
            met: false,
            reason: "Needs the HVSC music collection installed",
            remedyTarget: settingsSection("hvsc"),
          };
    case "session":
      return ctx.hasRestorableSession
        ? { met: true, reason: "" }
        : { met: false, reason: "Nothing has been played yet" };
  }
};

/**
 * The first unmet requirement decides the row, so the reason a user reads is the first thing that
 * has to change rather than the last of several.
 */
export const resolveEntry = (entry: SearchEntry, ctx: RequirementContext): ResolvedSearchEntry => {
  for (const requirement of entry.requires ?? []) {
    const verdict = resolveRequirement(requirement, ctx);
    if (!verdict.met) {
      return {
        entry,
        enabled: false,
        disabledReason: verdict.reason,
        ...(verdict.remedyTarget ? { remedyTarget: verdict.remedyTarget } : {}),
      };
    }
  }
  return { entry, enabled: true, disabledReason: null };
};
