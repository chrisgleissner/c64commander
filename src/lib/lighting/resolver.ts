import {
  LIGHTING_CIRCADIAN_PERIOD_LABELS,
  LIGHTING_PERIOD_MODIFIERS,
  LIGHTING_SOURCE_BUCKET_LABELS,
} from "@/lib/lighting/constants";
import { normalizeSurfaceStateForCapability } from "@/lib/lighting/capabilities";
import type {
  LightingConnectionSentinelState,
  LightingContextLensEntry,
  LightingProfile,
  LightingResolverInput,
  LightingResolverOutput,
  LightingSurface,
  LightingSurfaceState,
} from "@/lib/lighting/types";

const resolveProfileById = (profiles: LightingProfile[], profileId: string | null) =>
  profiles.find((profile) => profile.id === profileId) ?? null;

const mergeSurfaceStates = (
  base: LightingSurfaceState | undefined,
  override: LightingSurfaceState | undefined,
): LightingSurfaceState | undefined => {
  if (!base && !override) return undefined;
  return {
    ...base,
    ...override,
    color: override?.color ?? base?.color,
  };
};

const isCriticalConnectionState = (state: LightingConnectionSentinelState | null) =>
  state === "disconnected" || state === "error";

const applyCircadianModifier = (
  state: LightingSurfaceState | undefined,
  period: NonNullable<LightingResolverInput["circadian"]>,
) => {
  if (!state) return undefined;
  const modifier = LIGHTING_PERIOD_MODIFIERS[period.period];
  return {
    ...state,
    intensity:
      typeof state.intensity === "number" ? Math.round(state.intensity * modifier.intensityMultiplier) : undefined,
    tint: modifier.tint,
  };
};

const pushContext = (
  entries: LightingContextLensEntry[],
  surface: LightingSurface,
  owner: LightingContextLensEntry["owner"],
  label: string,
  detail: string,
) => {
  entries.push({ surface, owner, label, detail });
};

export const resolveLightingState = (input: LightingResolverInput): LightingResolverOutput => {
  const activeProfile = resolveProfileById(input.studioState.profiles, input.studioState.activeProfileId);
  const resolvedState: Partial<Record<LightingSurface, LightingSurfaceState>> = {};
  const contextLens: LightingContextLensEntry[] = [];
  let activeAutomationChip: string | null = null;

  (["case", "keyboard"] as const).forEach((surface) => {
    const capability = input.capabilities[surface];
    const baseProfileSurface = normalizeSurfaceStateForCapability(capability, activeProfile?.surfaces[surface]);
    const previewSurface = normalizeSurfaceStateForCapability(capability, input.previewState?.[surface]);
    const lockSurface = normalizeSurfaceStateForCapability(capability, input.manualLockState?.[surface]);

    let finalState =
      baseProfileSurface ?? normalizeSurfaceStateForCapability(capability, input.rawDeviceState[surface]) ?? undefined;
    let owner: LightingContextLensEntry["owner"] = baseProfileSurface ? "profile" : "device-fallback";
    let label = baseProfileSurface && activeProfile ? activeProfile.name : "Device fallback";
    let detail = baseProfileSurface ? "Active base profile" : "Using current device lighting state";

    const ambientConnectionProfile =
      input.connectionState &&
      !isCriticalConnectionState(input.connectionState) &&
      input.studioState.automation.connectionSentinel.enabled
        ? resolveProfileById(
            input.studioState.profiles,
            input.studioState.automation.connectionSentinel.mappings[input.connectionState] ?? null,
          )
        : null;
    if (ambientConnectionProfile?.surfaces[surface]) {
      finalState =
        normalizeSurfaceStateForCapability(capability, ambientConnectionProfile.surfaces[surface]) ?? finalState;
      owner = "connection-ambient";
      label = `Device status: ${input.connectionState}`;
      detail = `Ambient connection mapping from ${ambientConnectionProfile.name}`;
      if (!activeAutomationChip) {
        activeAutomationChip = `Auto: ${input.connectionState[0].toUpperCase()}${input.connectionState.slice(1)}`;
      }
    }

    if (input.circadian && input.studioState.automation.circadian.enabled) {
      finalState = applyCircadianModifier(finalState, input.circadian) ?? finalState;
      owner = "circadian";
      label = `Circadian ${LIGHTING_CIRCADIAN_PERIOD_LABELS[input.circadian.period]}`;
      detail = input.circadian.fallbackActive
        ? `Fallback schedule from ${input.circadian.resolvedLocation.label}`
        : `Solar schedule from ${input.circadian.resolvedLocation.label}`;
      activeAutomationChip = `Circadian: ${LIGHTING_CIRCADIAN_PERIOD_LABELS[input.circadian.period]}`;
    }

    if (input.sourceBucket && input.studioState.automation.sourceIdentityMap.enabled) {
      const profile = resolveProfileById(
        input.studioState.profiles,
        input.studioState.automation.sourceIdentityMap.mappings[input.sourceBucket] ?? null,
      );
      if (profile?.surfaces[surface]) {
        finalState = normalizeSurfaceStateForCapability(capability, profile.surfaces[surface]) ?? finalState;
        owner = "source-identity";
        label = LIGHTING_SOURCE_BUCKET_LABELS[input.sourceBucket];
        detail = `Source mapping from ${profile.name}`;
        activeAutomationChip = `Source: ${LIGHTING_SOURCE_BUCKET_LABELS[input.sourceBucket].replace(" look", "")}`;
      }
    }

    if (input.quietLaunchActive && input.studioState.automation.quietLaunch.enabled) {
      const quietProfile = resolveProfileById(
        input.studioState.profiles,
        input.studioState.automation.quietLaunch.profileId,
      );
      if (quietProfile?.surfaces[surface]) {
        finalState = normalizeSurfaceStateForCapability(capability, quietProfile.surfaces[surface]) ?? finalState;
        owner = "quiet-launch";
        label = quietProfile.name;
        detail = "Startup window is still active";
        activeAutomationChip = "Quiet Launch";
      }
    }

    if (input.manualLockEnabled && lockSurface) {
      finalState = lockSurface;
      owner = "manual-lock";
      label = "Manual lock";
      detail = "Non-critical automations are paused";
      activeAutomationChip = "Manual lock";
    }

    if (
      input.connectionState &&
      isCriticalConnectionState(input.connectionState) &&
      input.studioState.automation.connectionSentinel.enabled
    ) {
      const profile = resolveProfileById(
        input.studioState.profiles,
        input.studioState.automation.connectionSentinel.mappings[input.connectionState] ?? null,
      );
      if (profile?.surfaces[surface]) {
        finalState = normalizeSurfaceStateForCapability(capability, profile.surfaces[surface]) ?? finalState;
        owner = "connection-critical";
        label = `Device status: ${input.connectionState}`;
        detail = `Critical override from ${profile.name}`;
        activeAutomationChip = `Auto: ${input.connectionState[0].toUpperCase()}${input.connectionState.slice(1)}`;
      }
    }

    if (previewSurface) {
      finalState = mergeSurfaceStates(finalState, previewSurface);
      owner = "preview";
      label = "Studio preview";
      detail = "Preview overrides the normal resolver until applied or cancelled";
    }

    resolvedState[surface] = finalState;
    pushContext(contextLens, surface, owner, label, detail);
  });

  const sourceCue =
    input.sourceBucket &&
    contextLens.some((entry) => entry.owner === "source-identity") &&
    !contextLens.some(
      (entry) =>
        entry.owner === "preview" ||
        entry.owner === "manual-lock" ||
        entry.owner === "quiet-launch" ||
        entry.owner === "connection-critical",
    )
      ? {
          bucket: input.sourceBucket,
          label: LIGHTING_SOURCE_BUCKET_LABELS[input.sourceBucket],
        }
      : null;

  return {
    resolvedState,
    activeProfile,
    activeAutomationChip,
    contextLens,
    sourceCue,
    circadianChip:
      input.circadian && input.studioState.automation.circadian.enabled
        ? `Circadian: ${LIGHTING_CIRCADIAN_PERIOD_LABELS[input.circadian.period]}`
        : null,
  };
};
