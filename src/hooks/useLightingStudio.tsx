/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React from "react";
import { useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { getC64API } from "@/lib/c64api";
import { useC64ConfigItems, useC64Connection, VISIBLE_C64_QUERY_OPTIONS } from "@/hooks/useC64Connection";
import { useConnectionState } from "@/hooks/useConnectionState";
import { getActiveBaseUrl, updateHasChanges } from "@/lib/config/appConfigStore";
import { buildErrorLogDetails, addLog } from "@/lib/logging";
import {
  LIGHTING_CATEGORY_ITEMS,
  LIGHTING_CONNECTION_HOLD_MS,
  LIGHTING_SURFACE_TO_CATEGORY,
} from "@/lib/lighting/constants";
import {
  buildLightingUpdatePayload,
  lightingStateEquals,
  normalizeLightingCapability,
  normalizeLightingState,
  normalizeSurfaceStateForCapability,
} from "@/lib/lighting/capabilities";
import { resolveLightingState } from "@/lib/lighting/resolver";
import { calculateSolarTimes, resolveCircadianPhase } from "@/lib/lighting/solar";
import { loadLightingStudioState, saveLightingStudioState } from "@/lib/lighting/store";
import type {
  LightingCircadianResolvedLocation,
  LightingConnectionSentinelState,
  LightingProfile,
  LightingSourceBucket,
  LightingStudioPlaybackContext,
  LightingStudioState,
  LightingSurface,
  LightingSurfaceState,
} from "@/lib/lighting/types";

type LightingStudioContextValue = {
  studioState: LightingStudioState;
  capabilities: ReturnType<typeof buildCapabilities>;
  rawDeviceState: Partial<Record<LightingSurface, LightingSurfaceState>>;
  resolved: ReturnType<typeof resolveLightingState>;
  connectionSentinelState: LightingConnectionSentinelState | null;
  circadianState: {
    period: "morning" | "day" | "evening" | "night";
    nextBoundaryLabel: string;
    fallbackActive: boolean;
    resolvedLocation: LightingCircadianResolvedLocation;
  } | null;
  playbackContext: LightingStudioPlaybackContext;
  studioOpen: boolean;
  contextLensOpen: boolean;
  previewState: Partial<Record<LightingSurface, LightingSurfaceState>> | null;
  manualLockEnabled: boolean;
  deviceLocationStatus: "idle" | "pending" | "granted" | "denied" | "error";
  deviceLocationError: string | null;
  openStudio: () => void;
  closeStudio: () => void;
  openContextLens: () => void;
  closeContextLens: () => void;
  setPreviewState: (state: Partial<Record<LightingSurface, LightingSurfaceState>> | null) => void;
  clearPreviewState: () => void;
  applyPreviewAsProfileBase: (profileId?: string | null) => void;
  setActiveProfileId: (profileId: string | null) => void;
  saveProfile: (name: string, surfaces: Partial<Record<LightingSurface, LightingSurfaceState>>) => LightingProfile;
  duplicateProfile: (profileId: string) => LightingProfile | null;
  renameProfile: (profileId: string, name: string) => void;
  deleteProfile: (profileId: string) => void;
  togglePinProfile: (profileId: string) => void;
  updateAutomation: (updater: (state: LightingStudioState["automation"]) => LightingStudioState["automation"]) => void;
  setPlaybackContext: (context: LightingStudioPlaybackContext) => void;
  setManualLockEnabled: (value: boolean) => void;
  lockCurrentLook: () => void;
  unlockCurrentLook: () => void;
  markManualLightingChange: () => void;
  updateCircadianLocationPreference: (
    update: Partial<LightingStudioState["automation"]["circadian"]["locationPreference"]>,
  ) => void;
  requestDeviceLocation: () => void;
  isActiveProfileModified: boolean;
};

const buildCapabilities = (caseConfig?: Record<string, unknown>, keyboardConfig?: Record<string, unknown>) => ({
  case: normalizeLightingCapability("case", caseConfig),
  keyboard: normalizeLightingCapability("keyboard", keyboardConfig),
});

const formatBoundaryTime = (date: Date) =>
  date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

const buildProfileId = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto && crypto.randomUUID()) ||
  `lighting-${Date.now()}-${Math.round(Math.random() * 1e6)}`;

const cloneSurfaces = (surfaces: Partial<Record<LightingSurface, LightingSurfaceState>>) =>
  JSON.parse(JSON.stringify(surfaces)) as Partial<Record<LightingSurface, LightingSurfaceState>>;

const isPermissionDeniedError = (error: GeolocationPositionError) =>
  error.code === error.PERMISSION_DENIED || error.code === 1;

const defaultCapabilities = buildCapabilities(undefined, undefined);
const defaultStudioState = loadLightingStudioState();
const defaultResolved = resolveLightingState({
  capabilities: defaultCapabilities,
  rawDeviceState: {},
  studioState: defaultStudioState,
  previewState: null,
  manualLockState: null,
  manualLockEnabled: false,
  connectionState: null,
  quietLaunchActive: false,
  sourceBucket: null,
  circadian: null,
});

const defaultContextValue: LightingStudioContextValue = {
  studioState: defaultStudioState,
  capabilities: defaultCapabilities,
  rawDeviceState: {},
  resolved: defaultResolved,
  connectionSentinelState: null,
  circadianState: null,
  playbackContext: { sourceBucket: null, activeItemLabel: null },
  studioOpen: false,
  contextLensOpen: false,
  previewState: null,
  manualLockEnabled: false,
  deviceLocationStatus: "idle",
  deviceLocationError: null,
  openStudio: () => undefined,
  closeStudio: () => undefined,
  openContextLens: () => undefined,
  closeContextLens: () => undefined,
  setPreviewState: () => undefined,
  clearPreviewState: () => undefined,
  applyPreviewAsProfileBase: () => undefined,
  setActiveProfileId: () => undefined,
  saveProfile: (name, surfaces) => ({
    id: `noop-${name}`,
    name,
    savedAt: new Date(0).toISOString(),
    surfaces,
  }),
  duplicateProfile: () => null,
  renameProfile: () => undefined,
  deleteProfile: () => undefined,
  togglePinProfile: () => undefined,
  updateAutomation: () => undefined,
  setPlaybackContext: () => undefined,
  setManualLockEnabled: () => undefined,
  lockCurrentLook: () => undefined,
  unlockCurrentLook: () => undefined,
  markManualLightingChange: () => undefined,
  updateCircadianLocationPreference: () => undefined,
  requestDeviceLocation: () => undefined,
  isActiveProfileModified: false,
};

const LightingStudioContext = React.createContext<LightingStudioContextValue>(defaultContextValue);

export function LightingStudioProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const { status } = useC64Connection();
  const connectionSnapshot = useConnectionState();

  const [studioState, setStudioState] = React.useState<LightingStudioState>(() => loadLightingStudioState());
  const [studioOpen, setStudioOpen] = React.useState(false);
  const [contextLensOpen, setContextLensOpen] = React.useState(false);
  const [previewState, setPreviewState] = React.useState<Partial<Record<LightingSurface, LightingSurfaceState>> | null>(
    null,
  );
  const [manualLockEnabled, setManualLockEnabled] = React.useState(false);
  const [manualLockState, setManualLockState] = React.useState<Partial<
    Record<LightingSurface, LightingSurfaceState>
  > | null>(null);
  const [playbackContext, setPlaybackContext] = React.useState<LightingStudioPlaybackContext>({
    sourceBucket: null,
    activeItemLabel: null,
  });
  const [deviceLocationStatus, setDeviceLocationStatus] = React.useState<
    "idle" | "pending" | "granted" | "denied" | "error"
  >("idle");
  const [deviceLocationError, setDeviceLocationError] = React.useState<string | null>(null);
  const [deviceCoordinates, setDeviceCoordinates] = React.useState<{ lat: number; lon: number } | null>(null);
  const [startupWindowStartedAt, setStartupWindowStartedAt] = React.useState(() => Date.now());
  const [quietLaunchDismissedAt, setQuietLaunchDismissedAt] = React.useState<number | null>(null);
  const lastConnectionStateRef = React.useRef(connectionSnapshot.state);
  const lastAppliedSignatureRef = React.useRef<string | null>(null);
  const lastAmbientConnectionRef = React.useRef<{ state: LightingConnectionSentinelState; at: number } | null>(null);

  const { data: caseLightingCategory } = useC64ConfigItems(
    "LED Strip Settings",
    [...LIGHTING_CATEGORY_ITEMS],
    status.isConnected || status.isConnecting,
    VISIBLE_C64_QUERY_OPTIONS,
  );
  const { data: keyboardLightingCategory } = useC64ConfigItems(
    "Keyboard Lighting",
    [...LIGHTING_CATEGORY_ITEMS],
    status.isConnected || status.isConnecting,
    VISIBLE_C64_QUERY_OPTIONS,
  );

  const caseConfig = React.useMemo(
    () =>
      (caseLightingCategory as Record<string, unknown> | undefined)?.["LED Strip Settings"]
        ? ((caseLightingCategory as Record<string, unknown>)["LED Strip Settings"] as Record<string, unknown>)
        : (caseLightingCategory as Record<string, unknown> | undefined),
    [caseLightingCategory],
  );
  const keyboardConfig = React.useMemo(
    () =>
      (keyboardLightingCategory as Record<string, unknown> | undefined)?.["Keyboard Lighting"]
        ? ((keyboardLightingCategory as Record<string, unknown>)["Keyboard Lighting"] as Record<string, unknown>)
        : (keyboardLightingCategory as Record<string, unknown> | undefined),
    [keyboardLightingCategory],
  );

  const capabilities = React.useMemo(() => buildCapabilities(caseConfig, keyboardConfig), [caseConfig, keyboardConfig]);

  const rawDeviceState = React.useMemo<Partial<Record<LightingSurface, LightingSurfaceState>>>(() => {
    const next: Partial<Record<LightingSurface, LightingSurfaceState>> = {};
    const caseState = normalizeLightingState(capabilities.case, caseConfig);
    if (caseState) next.case = caseState;
    const keyboardState = normalizeLightingState(capabilities.keyboard, keyboardConfig);
    if (keyboardState) next.keyboard = keyboardState;
    return next;
  }, [capabilities, caseConfig, keyboardConfig]);

  React.useEffect(() => {
    saveLightingStudioState(studioState);
  }, [studioState]);

  const requestDeviceLocation = React.useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setDeviceLocationStatus("error");
      setDeviceLocationError("Device location is unavailable on this platform.");
      return;
    }
    setDeviceLocationStatus("pending");
    setDeviceLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setDeviceCoordinates({ lat: position.coords.latitude, lon: position.coords.longitude });
        setDeviceLocationStatus("granted");
      },
      (error) => {
        const nextStatus = isPermissionDeniedError(error) ? "denied" : "error";
        setDeviceLocationStatus(nextStatus);
        setDeviceLocationError(error.message || "Unable to resolve device location.");
        addLog("warn", "Lighting Studio device location request failed", {
          status: nextStatus,
          message: error.message,
          code: error.code,
        });
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 10 * 60 * 1000 },
    );
  }, []);

  React.useEffect(() => {
    if (
      !studioState.automation.circadian.enabled ||
      !studioState.automation.circadian.locationPreference.useDeviceLocation
    )
      return;
    if (deviceLocationStatus === "granted" || deviceLocationStatus === "pending") return;
    requestDeviceLocation();
  }, [
    deviceLocationStatus,
    requestDeviceLocation,
    studioState.automation.circadian.enabled,
    studioState.automation.circadian.locationPreference.useDeviceLocation,
  ]);

  React.useEffect(() => {
    const previous = lastConnectionStateRef.current;
    if (
      (connectionSnapshot.state === "REAL_CONNECTED" || connectionSnapshot.state === "DEMO_ACTIVE") &&
      previous !== connectionSnapshot.state
    ) {
      setStartupWindowStartedAt(Date.now());
      setQuietLaunchDismissedAt(null);
      lastAppliedSignatureRef.current = null;
    }
    lastConnectionStateRef.current = connectionSnapshot.state;
  }, [connectionSnapshot.state]);

  const connectionSentinelState = React.useMemo<LightingConnectionSentinelState | null>(() => {
    let next: LightingConnectionSentinelState | null = null;
    if (status.state === "REAL_CONNECTED") next = "connected";
    else if (status.state === "DEMO_ACTIVE") next = "demo";
    else if (status.state === "DISCOVERING") {
      next = lastAmbientConnectionRef.current ? "retrying" : "connecting";
    } else if (status.error) {
      next = "error";
    } else if (status.state === "OFFLINE_NO_DEMO") {
      next = "disconnected";
    }

    if (next && next !== "connecting") {
      lastAmbientConnectionRef.current = { state: next, at: Date.now() };
      return next;
    }

    if (next === "connecting") {
      return next;
    }

    const held = lastAmbientConnectionRef.current;
    if (held && Date.now() - held.at <= LIGHTING_CONNECTION_HOLD_MS) {
      return held.state;
    }

    return next;
  }, [status.error, status.state]);

  const routeSourceBucket = React.useMemo<LightingSourceBucket | null>(() => {
    if (location.pathname.startsWith("/disks")) return "disks";
    if (location.pathname.startsWith("/play")) return playbackContext.sourceBucket ?? "idle";
    return null;
  }, [location.pathname, playbackContext.sourceBucket]);

  const circadianState = React.useMemo(() => {
    if (!studioState.automation.circadian.enabled) return null;
    const preference = studioState.automation.circadian.locationPreference;
    let resolvedLocation: LightingCircadianResolvedLocation;
    let solarInput: { lat: number; lon: number } | { city: string } | null = null;

    if (preference.useDeviceLocation && deviceCoordinates) {
      resolvedLocation = {
        source: "device",
        lat: deviceCoordinates.lat,
        lon: deviceCoordinates.lon,
        label: `Device ${deviceCoordinates.lat.toFixed(3)}, ${deviceCoordinates.lon.toFixed(3)}`,
      };
      solarInput = { lat: deviceCoordinates.lat, lon: deviceCoordinates.lon };
    } else if (preference.manualCoordinates) {
      resolvedLocation = {
        source: "manual",
        lat: preference.manualCoordinates.lat,
        lon: preference.manualCoordinates.lon,
        label: `Manual ${preference.manualCoordinates.lat.toFixed(3)}, ${preference.manualCoordinates.lon.toFixed(3)}`,
      };
      solarInput = { lat: preference.manualCoordinates.lat, lon: preference.manualCoordinates.lon };
    } else if (preference.city) {
      resolvedLocation = {
        source: "city",
        lat: 0,
        lon: 0,
        label: preference.city,
      };
      solarInput = { city: preference.city };
    } else {
      resolvedLocation = { source: "unresolved", label: "Location needed" };
    }

    if (!solarInput) {
      return {
        period: "day" as const,
        nextBoundaryLabel: "Location needed",
        fallbackActive: true,
        resolvedLocation,
      };
    }

    try {
      const calculation = calculateSolarTimes(solarInput, new Date());
      const phase = resolveCircadianPhase(new Date(), calculation.sunTimes);
      const resolved =
        resolvedLocation.source === "city"
          ? {
            source: "city" as const,
            lat: calculation.location.lat,
            lon: calculation.location.lon,
            label: calculation.location.label,
          }
          : resolvedLocation;
      return {
        period: phase.period,
        nextBoundaryLabel: formatBoundaryTime(phase.nextBoundary),
        fallbackActive: calculation.fallbackActive,
        resolvedLocation: resolved,
      };
    } catch (error) {
      addLog("warn", "Lighting Studio circadian resolution failed", buildErrorLogDetails(error as Error));
      return {
        period: "day" as const,
        nextBoundaryLabel: "Fallback schedule",
        fallbackActive: true,
        resolvedLocation,
      };
    }
  }, [
    deviceCoordinates,
    studioState.automation.circadian.enabled,
    studioState.automation.circadian.locationPreference,
  ]);

  React.useEffect(() => {
    if (!circadianState) return;
    setStudioState((current) =>
      current.lastResolvedLocation?.label === circadianState.resolvedLocation.label &&
        current.lastResolvedLocation?.source === circadianState.resolvedLocation.source
        ? current
        : {
          ...current,
          lastResolvedLocation: circadianState.resolvedLocation,
        },
    );
  }, [circadianState]);

  React.useEffect(() => {
    if (!studioState.automation.circadian.enabled) return;
    const timer = window.setInterval(() => {
      setStudioState((current) => ({ ...current }));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [studioState.automation.circadian.enabled]);

  const quietLaunchActive =
    studioState.automation.quietLaunch.enabled &&
    quietLaunchDismissedAt === null &&
    Date.now() - startupWindowStartedAt <= studioState.automation.quietLaunch.windowMs;

  const resolved = React.useMemo(
    () =>
      resolveLightingState({
        capabilities,
        rawDeviceState,
        studioState,
        previewState,
        manualLockState,
        manualLockEnabled,
        connectionState: connectionSentinelState,
        quietLaunchActive,
        sourceBucket: routeSourceBucket,
        circadian: circadianState,
      }),
    [
      capabilities,
      rawDeviceState,
      studioState,
      previewState,
      manualLockState,
      manualLockEnabled,
      connectionSentinelState,
      quietLaunchActive,
      routeSourceBucket,
      circadianState,
    ],
  );

  const resolvedSignature = React.useMemo(() => JSON.stringify(resolved.resolvedState), [resolved.resolvedState]);

  React.useEffect(() => {
    if (!status.isConnected) return;
    if (resolvedSignature === lastAppliedSignatureRef.current) return;
    const payload: Record<string, Record<string, string | number>> = {};

    (["case", "keyboard"] as const).forEach((surface) => {
      const capability = capabilities[surface];
      const nextState = resolved.resolvedState[surface];
      const currentState = normalizeSurfaceStateForCapability(capability, rawDeviceState[surface]);
      if (!nextState || lightingStateEquals(nextState, currentState)) return;
      const updates = buildLightingUpdatePayload(capability, nextState);
      if (Object.keys(updates).length > 0) {
        payload[LIGHTING_SURFACE_TO_CATEGORY[surface]] = updates;
      }
    });

    if (Object.keys(payload).length === 0) {
      lastAppliedSignatureRef.current = resolvedSignature;
      return;
    }

    void getC64API()
      .updateConfigBatch(payload, { immediate: true })
      .then(() => {
        lastAppliedSignatureRef.current = resolvedSignature;
        updateHasChanges(getActiveBaseUrl(), true);
        void queryClient.invalidateQueries({ queryKey: ["c64-config-items", "LED Strip Settings"] });
        void queryClient.invalidateQueries({ queryKey: ["c64-config-items", "Keyboard Lighting"] });
        void queryClient.invalidateQueries({ queryKey: ["c64-category", "LED Strip Settings"] });
        void queryClient.invalidateQueries({ queryKey: ["c64-category", "Keyboard Lighting"] });
      })
      .catch((error) => {
        addLog(
          "error",
          "Lighting Studio failed to apply resolved lighting state",
          buildErrorLogDetails(error as Error),
        );
      });
  }, [capabilities, queryClient, rawDeviceState, resolved.resolvedState, resolvedSignature, status.isConnected]);

  const setActiveProfileId = React.useCallback((profileId: string | null) => {
    setStudioState((current) => ({ ...current, activeProfileId: profileId }));
    lastAppliedSignatureRef.current = null;
  }, []);

  const saveProfile = React.useCallback(
    (name: string, surfaces: Partial<Record<LightingSurface, LightingSurfaceState>>) => {
      const profile: LightingProfile = {
        id: buildProfileId(),
        name: name.trim(),
        savedAt: new Date().toISOString(),
        surfaces: cloneSurfaces(surfaces),
      };
      setStudioState((current) => ({
        ...current,
        activeProfileId: profile.id,
        profiles: [...current.profiles, profile],
      }));
      lastAppliedSignatureRef.current = null;
      return profile;
    },
    [],
  );

  const duplicateProfile = React.useCallback(
    (profileId: string) => {
      const profile = studioState.profiles.find((candidate) => candidate.id === profileId);
      if (!profile) return null;
      return saveProfile(`${profile.name} Copy`, profile.surfaces);
    },
    [saveProfile, studioState.profiles],
  );

  const renameProfile = React.useCallback((profileId: string, name: string) => {
    setStudioState((current) => ({
      ...current,
      profiles: current.profiles.map((profile) =>
        profile.id === profileId && !profile.bundled ? { ...profile, name: name.trim() } : profile,
      ),
    }));
  }, []);

  const deleteProfile = React.useCallback((profileId: string) => {
    setStudioState((current) => ({
      ...current,
      activeProfileId: current.activeProfileId === profileId ? null : current.activeProfileId,
      profiles: current.profiles.filter((profile) => profile.id !== profileId || profile.bundled),
    }));
    lastAppliedSignatureRef.current = null;
  }, []);

  const togglePinProfile = React.useCallback((profileId: string) => {
    setStudioState((current) => ({
      ...current,
      profiles: current.profiles.map((profile) =>
        profile.id === profileId ? { ...profile, pinned: !profile.pinned } : profile,
      ),
    }));
  }, []);

  const updateAutomation = React.useCallback(
    (updater: (state: LightingStudioState["automation"]) => LightingStudioState["automation"]) => {
      setStudioState((current) => ({ ...current, automation: updater(current.automation) }));
      lastAppliedSignatureRef.current = null;
    },
    [],
  );

  const updateCircadianLocationPreference = React.useCallback(
    (update: Partial<LightingStudioState["automation"]["circadian"]["locationPreference"]>) => {
      setStudioState((current) => ({
        ...current,
        automation: {
          ...current.automation,
          circadian: {
            ...current.automation.circadian,
            locationPreference: {
              ...current.automation.circadian.locationPreference,
              ...update,
            },
          },
        },
      }));
      lastAppliedSignatureRef.current = null;
    },
    [],
  );

  const markManualLightingChange = React.useCallback(() => {
    setQuietLaunchDismissedAt(Date.now());
    lastAppliedSignatureRef.current = null;
  }, []);

  const applyPreviewAsProfileBase = React.useCallback(
    (profileId?: string | null) => {
      if (!previewState) return;
      if (profileId) {
        setActiveProfileId(profileId);
      } else {
        const created = saveProfile("Current Look", previewState);
        setActiveProfileId(created.id);
      }
      setPreviewState(null);
      markManualLightingChange();
    },
    [markManualLightingChange, previewState, saveProfile, setActiveProfileId],
  );

  const lockCurrentLook = React.useCallback(() => {
    setManualLockState(cloneSurfaces(resolved.resolvedState));
    setManualLockEnabled(true);
    lastAppliedSignatureRef.current = null;
  }, [resolved.resolvedState]);

  const unlockCurrentLook = React.useCallback(() => {
    setManualLockEnabled(false);
    setManualLockState(null);
    lastAppliedSignatureRef.current = null;
  }, []);

  const isActiveProfileModified = React.useMemo(() => {
    const activeProfile = resolved.activeProfile;
    if (!activeProfile) return false;
    return (["case", "keyboard"] as const).some((surface) => {
      const expected = normalizeSurfaceStateForCapability(capabilities[surface], activeProfile.surfaces[surface]);
      const current = normalizeSurfaceStateForCapability(capabilities[surface], rawDeviceState[surface]);
      return !lightingStateEquals(expected, current);
    });
  }, [capabilities, rawDeviceState, resolved.activeProfile]);

  const value = React.useMemo<LightingStudioContextValue>(
    () => ({
      studioState,
      capabilities,
      rawDeviceState,
      resolved,
      connectionSentinelState,
      circadianState,
      playbackContext,
      studioOpen,
      contextLensOpen,
      previewState,
      manualLockEnabled,
      deviceLocationStatus,
      deviceLocationError,
      openStudio: () => setStudioOpen(true),
      closeStudio: () => setStudioOpen(false),
      openContextLens: () => setContextLensOpen(true),
      closeContextLens: () => setContextLensOpen(false),
      setPreviewState,
      clearPreviewState: () => setPreviewState(null),
      applyPreviewAsProfileBase,
      setActiveProfileId,
      saveProfile,
      duplicateProfile,
      renameProfile,
      deleteProfile,
      togglePinProfile,
      updateAutomation,
      setPlaybackContext,
      setManualLockEnabled,
      lockCurrentLook,
      unlockCurrentLook,
      markManualLightingChange,
      updateCircadianLocationPreference,
      requestDeviceLocation,
      isActiveProfileModified,
    }),
    [
      studioState,
      capabilities,
      rawDeviceState,
      resolved,
      connectionSentinelState,
      circadianState,
      playbackContext,
      studioOpen,
      contextLensOpen,
      previewState,
      manualLockEnabled,
      deviceLocationStatus,
      deviceLocationError,
      applyPreviewAsProfileBase,
      setActiveProfileId,
      saveProfile,
      duplicateProfile,
      renameProfile,
      deleteProfile,
      togglePinProfile,
      updateAutomation,
      lockCurrentLook,
      unlockCurrentLook,
      markManualLightingChange,
      updateCircadianLocationPreference,
      requestDeviceLocation,
      isActiveProfileModified,
    ],
  );

  return <LightingStudioContext.Provider value={value}>{children}</LightingStudioContext.Provider>;
}

export const useLightingStudio = () => {
  return React.useContext(LightingStudioContext);
};
