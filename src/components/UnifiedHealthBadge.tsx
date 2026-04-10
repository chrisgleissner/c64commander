/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { HealthCheckDetailView } from "@/components/diagnostics/HealthCheckDetailView";
import {
  AppSheet,
  AppSheetBody,
  AppSheetContent,
  AppSheetDescription,
  AppSheetHeader,
  AppSheetTitle,
} from "@/components/ui/app-surface";
import { Button } from "@/components/ui/button";
import { useHealthState } from "@/hooks/useHealthState";
import { useC64Connection } from "@/hooks/useC64Connection";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { useSavedDeviceHealthChecks } from "@/hooks/useSavedDeviceHealthChecks";
import { useSavedDevices } from "@/hooks/useSavedDevices";
import { useSavedDeviceSwitching } from "@/hooks/useSavedDeviceSwitching";
import {
  HEALTH_GLYPHS,
  getBadgeAriaLabel,
  getBadgeTextContract,
  type HealthState,
} from "@/lib/diagnostics/healthModel";
import { requestDiagnosticsOpen } from "@/lib/diagnostics/diagnosticsOverlay";
import { addErrorLog } from "@/lib/logging";
import {
  buildSavedDevicePrimaryLabel,
  getSavedDeviceSwitchStatus,
  type DeviceSwitchStatus,
} from "@/lib/savedDevices/store";
import { cn } from "@/lib/utils";

const BADGE_LONG_PRESS_MS = 450;

const resolvePickerStatusLabel = (status: DeviceSwitchStatus, isSelected: boolean) => {
  if (status === "verifying") return "Verifying";
  if (status === "offline") return "Offline";
  if (status === "mismatch") return "Mismatch";
  if (isSelected) return "Selected";
  return null;
};

const formatRelativeTime = (prefix: string, timestampMs: number | null) => {
  if (timestampMs === null || Number.isNaN(timestampMs)) return `${prefix} -`;
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  if (minutes === 0) {
    return `${prefix} ${seconds}s ago`;
  }
  return `${prefix} ${minutes}m ${seconds}s ago`;
};

const parseIsoTimestamp = (value: string | null) => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const resolveDeviceHealthLabel = (
  snapshot: ReturnType<typeof useSavedDeviceHealthChecks>["byDeviceId"][string] | undefined,
) => {
  if (!snapshot) return "Pending";
  if (snapshot.running) return "Checking";
  if (snapshot.error) return "Check failed";
  if (!snapshot.latestResult) return "Pending";
  return snapshot.latestResult.overallHealth === "Unavailable" ? "Offline" : snapshot.latestResult.overallHealth;
};

const resolveCompletedProbeCount = (
  snapshot: ReturnType<typeof useSavedDeviceHealthChecks>["byDeviceId"][string] | undefined,
) => {
  if (!snapshot?.liveProbes) return 0;
  return Object.keys(snapshot.liveProbes).length;
};

const resolveDeviceHealthSummary = (
  snapshot: ReturnType<typeof useSavedDeviceHealthChecks>["byDeviceId"][string] | undefined,
  totalProbeCount: number,
  switchStatusLabel: string | null,
) => {
  const switchPrefix = switchStatusLabel && switchStatusLabel !== "Selected" ? `${switchStatusLabel} selection` : null;

  if (!snapshot) {
    return [switchPrefix, "Waiting to start"].filter(Boolean).join(" · ");
  }

  if (snapshot.running) {
    return [
      switchPrefix,
      `${resolveCompletedProbeCount(snapshot)}/${totalProbeCount} probes`,
      formatRelativeTime("Started", parseIsoTimestamp(snapshot.lastStartedAt)),
    ]
      .filter(Boolean)
      .join(" · ");
  }

  if (snapshot.error) {
    return [
      switchPrefix,
      "Latest check failed",
      formatRelativeTime("Last check", parseIsoTimestamp(snapshot.lastCompletedAt)),
    ]
      .filter(Boolean)
      .join(" · ");
  }

  return [switchPrefix, formatRelativeTime("Last check", parseIsoTimestamp(snapshot.lastCompletedAt))]
    .filter(Boolean)
    .join(" · ");
};

const resolveHealthProblemCount = (result: HealthCheckRunResult | null | undefined) => {
  if (!result) return 0;
  return Object.values(result.probes).filter((probe) => probe.outcome === "Fail").length;
};

type PickerBadgeContract = {
  healthState: HealthState;
  badgeText: ReturnType<typeof getBadgeTextContract>;
};

const resolvePickerBadgeContract = (
  snapshot: ReturnType<typeof useSavedDeviceHealthChecks>["byDeviceId"][string] | undefined,
): PickerBadgeContract => {
  if (!snapshot) {
    return {
      healthState: "Idle",
      badgeText: {
        leadingLabel: "Pending",
        glyph: HEALTH_GLYPHS.Idle,
        countLabel: null,
        trailingLabel: null,
      },
    };
  }

  if (snapshot.running && !snapshot.latestResult) {
    return {
      healthState: "Idle",
      badgeText: {
        leadingLabel: "Checking",
        glyph: HEALTH_GLYPHS.Idle,
        countLabel: null,
        trailingLabel: null,
      },
    };
  }

  if (snapshot.running && snapshot.latestResult) {
    const healthState = snapshot.latestResult.overallHealth;
    return {
      healthState,
      badgeText: getBadgeTextContract(
        healthState,
        "Checking",
        resolveHealthProblemCount(snapshot.latestResult),
        "medium",
        HEALTH_GLYPHS[healthState],
        null,
        "Checking",
      ),
    };
  }

  if (snapshot.error) {
    return {
      healthState: "Unavailable",
      badgeText: getBadgeTextContract("Unavailable", "Offline", 0, "medium", HEALTH_GLYPHS.Unavailable),
    };
  }

  if (!snapshot.latestResult) {
    return {
      healthState: "Idle",
      badgeText: {
        leadingLabel: "Pending",
        glyph: HEALTH_GLYPHS.Idle,
        countLabel: null,
        trailingLabel: null,
      },
    };
  }

  const healthState = snapshot.latestResult.overallHealth;
  const connectivity = snapshot.latestResult.connectivity;
  return {
    healthState,
    badgeText: getBadgeTextContract(
      healthState,
      connectivity,
      resolveHealthProblemCount(snapshot.latestResult),
      "medium",
      HEALTH_GLYPHS[healthState],
      null,
      connectivity === "Online" || connectivity === "Checking" ? connectivity : undefined,
    ),
  };
};

function PickerHealthStatusBadge({
  snapshot,
  testId,
}: {
  snapshot: ReturnType<typeof useSavedDeviceHealthChecks>["byDeviceId"][string] | undefined;
  testId: string;
}) {
  const { badgeText, healthState } = resolvePickerBadgeContract(snapshot);
  const glyphColor = HEALTH_COLOR[healthState];

  return (
    <span
      className="inline-flex w-fit max-w-full shrink-0 min-w-0 items-center overflow-hidden rounded-full"
      data-testid={testId}
    >
      <span
        className="app-chrome-badge-surface inline-flex min-w-0 max-w-full items-center overflow-hidden rounded-full px-2 py-[0.25rem]"
        aria-hidden="true"
      >
        <span className="inline-flex min-w-0 max-w-full items-center overflow-hidden whitespace-nowrap leading-none">
          <span className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground">
            {badgeText.leadingLabel}
          </span>
          <span className="shrink-0 whitespace-pre" aria-hidden="true">
            {" "}
          </span>
          <span
            className={cn(
              "inline-flex h-[1em] w-[1em] shrink-0 items-center justify-center align-middle font-sans text-[0.95rem] leading-none transform-gpu",
              glyphColor,
              HEALTH_GLYPH_VISUAL_CLASS[healthState],
              HEALTH_GLYPH_ALIGNMENT_CLASS[healthState],
            )}
          >
            {badgeText.glyph}
          </span>
          {badgeText.countLabel ? (
            <>
              <span className="shrink-0 whitespace-pre" aria-hidden="true">
                {" "}
              </span>
              <span className={cn("shrink-0 text-[10px] font-semibold leading-none", glyphColor)}>
                {badgeText.countLabel}
              </span>
            </>
          ) : null}
          {badgeText.trailingLabel ? (
            <>
              <span className="shrink-0 whitespace-pre" aria-hidden="true">
                {" "}
              </span>
              <span className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground">
                {badgeText.trailingLabel}
              </span>
            </>
          ) : null}
        </span>
      </span>
    </span>
  );
}

// §8.3 — Color classes per health state (shape is primary; color reinforces only)
const HEALTH_COLOR: Record<HealthState, string> = {
  Healthy: "text-success",
  Degraded: "text-amber-500",
  Unhealthy: "text-destructive",
  Idle: "text-muted-foreground",
  Unavailable: "text-muted-foreground",
};

const HEALTH_GLYPH_VISUAL_CLASS: Record<HealthState, string> = {
  Healthy: "scale-[1.42]",
  Degraded: "scale-100",
  Unhealthy: "scale-100",
  Idle: "scale-[1.08]",
  Unavailable: "scale-[1.08]",
};

const HEALTH_GLYPH_ALIGNMENT_CLASS: Record<HealthState, string> = {
  Healthy: "translate-y-[-0.11em]",
  Degraded: "translate-y-[-0.03em]",
  Unhealthy: "translate-y-[-0.02em]",
  Idle: "translate-y-[-0.06em]",
  Unavailable: "translate-y-[-0.05em]",
};

type Props = {
  className?: string;
};

/**
 * Unified header badge (§8).
 *
 * Shape encodes health state; text label encodes connectivity.
 * Tapping opens the diagnostics overlay (§8.9).
 */
export function UnifiedHealthBadge({ className }: Props) {
  const { state, connectivity, problemCount, connectedDeviceLabel } = useHealthState();
  const savedDevices = useSavedDevices();
  const switchSavedDevice = useSavedDeviceSwitching();
  const {
    status: { state: rawConnectionState, deviceInfo },
  } = useC64Connection();
  const { profile } = useDisplayProfile();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [expandedDeviceIds, setExpandedDeviceIds] = useState<string[]>([]);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressHandledRef = useRef(false);
  const suppressClickRef = useRef(false);

  const canSwitchDevices = savedDevices.devices.length > 1;
  const {
    byDeviceId: healthByDeviceId,
    refreshAll,
    totalProbeCount,
  } = useSavedDeviceHealthChecks(savedDevices.devices, pickerOpen && canSwitchDevices);

  const glyph = HEALTH_GLYPHS[state];
  const ariaLabel = getBadgeAriaLabel(state, connectivity, problemCount, deviceInfo?.product, connectedDeviceLabel);
  const glyphColor = HEALTH_COLOR[state];
  const badgeText = getBadgeTextContract(
    state,
    connectivity,
    problemCount,
    profile,
    glyph,
    deviceInfo?.product,
    connectedDeviceLabel,
  );
  const expandedDeviceIdSet = useMemo(() => new Set(expandedDeviceIds), [expandedDeviceIds]);
  const pickerBadgeOwnLine = profile !== "expanded";
  const pickerRefreshRequestedRef = useRef(false);

  useEffect(() => {
    if (!pickerOpen) {
      setExpandedDeviceIds([]);
    }
  }, [pickerOpen]);

  useEffect(() => {
    if (pickerOpen && canSwitchDevices && !pickerRefreshRequestedRef.current) {
      pickerRefreshRequestedRef.current = true;
      void refreshAll();
      return;
    }

    if (!pickerOpen) {
      pickerRefreshRequestedRef.current = false;
    }
  }, [canSwitchDevices, pickerOpen, refreshAll]);

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const openSwitchPicker = useCallback(() => {
    if (!canSwitchDevices) return;
    longPressHandledRef.current = true;
    suppressClickRef.current = true;
    setPickerOpen(true);
  }, [canSwitchDevices]);

  const handlePointerDown = useCallback(() => {
    if (!canSwitchDevices) return;
    longPressHandledRef.current = false;
    suppressClickRef.current = false;
    clearLongPress();
    longPressTimerRef.current = window.setTimeout(() => {
      openSwitchPicker();
    }, BADGE_LONG_PRESS_MS);
  }, [canSwitchDevices, clearLongPress, openSwitchPicker]);

  const handleClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    if (suppressClickRef.current || longPressHandledRef.current) {
      event.preventDefault();
      suppressClickRef.current = false;
      longPressHandledRef.current = false;
      return;
    }
    requestDiagnosticsOpen("header");
  }, []);

  const handlePickerOpenChange = useCallback(
    (open: boolean) => {
      clearLongPress();
      if (!open) {
        suppressClickRef.current = false;
        longPressHandledRef.current = false;
      }
      setPickerOpen(open);
    },
    [clearLongPress],
  );

  const toggleDeviceDetails = useCallback((deviceId: string) => {
    setExpandedDeviceIds((current) =>
      current.includes(deviceId) ? current.filter((value) => value !== deviceId) : [...current, deviceId],
    );
  }, []);

  const handleSwitchDevice = useCallback(
    async (deviceId: string) => {
      if (deviceId === savedDevices.selectedDeviceId) {
        setPickerOpen(false);
        return;
      }

      try {
        await switchSavedDevice(deviceId);
        setPickerOpen(false);
      } catch (error) {
        addErrorLog("Saved device switch failed", {
          deviceId,
          error: (error as Error).message,
        });
      }
    },
    [savedDevices.selectedDeviceId, switchSavedDevice],
  );

  return (
    <>
      <button
        type="button"
        role="button"
        aria-label={ariaLabel}
        data-testid="unified-health-badge"
        data-connection-state={rawConnectionState}
        data-health-state={state}
        data-connectivity-state={connectivity}
        data-connected-device={
          connectivity === "Online" || connectivity === "Checking" ? (connectedDeviceLabel ?? null) : null
        }
        onPointerDown={handlePointerDown}
        onPointerUp={clearLongPress}
        onPointerLeave={clearLongPress}
        onPointerCancel={clearLongPress}
        onClick={handleClick}
        className={cn(
          "app-chrome-badge inline-flex shrink min-w-0 items-center overflow-hidden rounded-md bg-transparent px-0 py-0 min-h-[44px] touch-none",
          profile === "compact" ? "max-w-[min(48vw,12rem)]" : "max-w-full",
          "text-foreground transition-opacity hover:opacity-90 active:opacity-80",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-0",
          className,
        )}
      >
        <span
          className="app-chrome-badge-surface inline-flex min-w-0 max-w-full items-center overflow-hidden rounded-md px-2 py-[0.3rem]"
          aria-hidden="true"
        >
          <span className="inline-flex min-w-0 max-w-full items-center overflow-hidden whitespace-nowrap leading-none">
            <span
              className="truncate text-xs font-semibold uppercase tracking-[0.14em] text-foreground"
              data-overlay-critical="badge"
            >
              {badgeText.leadingLabel}
            </span>
            <span className="shrink-0 whitespace-pre" aria-hidden="true">
              {" "}
            </span>
            <span
              className={cn(
                "inline-flex h-[1em] w-[1em] shrink-0 items-center justify-center align-middle font-sans text-[1rem] leading-none transform-gpu",
                glyphColor,
                HEALTH_GLYPH_VISUAL_CLASS[state],
                HEALTH_GLYPH_ALIGNMENT_CLASS[state],
              )}
              data-overlay-critical="badge"
            >
              {badgeText.glyph}
            </span>
            {badgeText.countLabel ? (
              <>
                <span className="shrink-0 whitespace-pre" aria-hidden="true">
                  {" "}
                </span>
                <span
                  className={cn("shrink-0 text-xs font-semibold leading-none", glyphColor)}
                  data-overlay-critical="badge"
                >
                  {badgeText.countLabel}
                </span>
              </>
            ) : null}
            {badgeText.trailingLabel ? (
              <>
                <span className="shrink-0 whitespace-pre" aria-hidden="true">
                  {" "}
                </span>
                <span
                  className="truncate text-xs font-semibold uppercase tracking-[0.14em] text-foreground"
                  data-overlay-critical="badge"
                >
                  {badgeText.trailingLabel}
                </span>
              </>
            ) : null}
          </span>
        </span>
      </button>

      <AppSheet open={pickerOpen} onOpenChange={handlePickerOpenChange}>
        <AppSheetContent className="overflow-hidden p-0 sm:w-[min(100vw-2rem,42rem)]" data-testid="switch-device-sheet">
          <AppSheetHeader>
            <AppSheetTitle>Switch device</AppSheetTitle>
            <AppSheetDescription>
              Choose a saved device. Checks refresh automatically every 10s while open.
            </AppSheetDescription>
          </AppSheetHeader>
          <AppSheetBody className="space-y-3 px-4 py-4 sm:px-5">
            {savedDevices.devices.map((device) => {
              const verified = savedDevices.verifiedByDeviceId[device.id] ?? null;
              const isSelected = device.id === savedDevices.selectedDeviceId;
              const status = isSelected ? getSavedDeviceSwitchStatus(device.id) : "last-known";
              const statusLabel = resolvePickerStatusLabel(status, isSelected);
              const healthSnapshot = healthByDeviceId[device.id];
              const isExpanded = expandedDeviceIdSet.has(device.id);

              return (
                <div
                  key={device.id}
                  className={cn(
                    "rounded-lg border border-border/70 bg-background",
                    isSelected ? "border-primary/60 bg-primary/10 ring-1 ring-primary/35" : "bg-background",
                  )}
                  data-selected={isSelected ? "true" : "false"}
                >
                  <div className="flex items-start gap-2 px-2 py-2">
                    <button
                      type="button"
                      className={cn(
                        "flex min-w-0 flex-1 rounded-md px-1 py-1 text-left transition-colors",
                        isSelected ? "hover:bg-primary/15" : "hover:bg-muted/40",
                        pickerBadgeOwnLine ? "flex-col items-stretch gap-2" : "items-start justify-between gap-3",
                      )}
                      onClick={() => {
                        void handleSwitchDevice(device.id);
                      }}
                      data-testid={`switch-device-row-${device.id}`}
                      data-badge-layout={pickerBadgeOwnLine ? "stacked" : "inline"}
                    >
                      <span className="min-w-0">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">
                            {buildSavedDevicePrimaryLabel(device, verified)}
                          </span>
                          {statusLabel ? (
                            <span className="shrink-0 rounded-full border border-border/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                              {statusLabel}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {resolveDeviceHealthSummary(healthSnapshot, totalProbeCount, statusLabel)}
                        </span>
                      </span>
                      {pickerBadgeOwnLine ? (
                        <span className="flex min-w-0 max-w-full items-start">
                          <PickerHealthStatusBadge
                            snapshot={healthSnapshot}
                            testId={`switch-device-status-${device.id}`}
                          />
                        </span>
                      ) : (
                        <PickerHealthStatusBadge
                          snapshot={healthSnapshot}
                          testId={`switch-device-status-${device.id}`}
                        />
                      )}
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 shrink-0 self-start p-0 text-muted-foreground hover:text-foreground"
                      data-testid={`switch-device-expand-${device.id}`}
                      aria-expanded={isExpanded}
                      aria-label={isExpanded ? "Collapse device health detail" : "Expand device health detail"}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        toggleDeviceDetails(device.id);
                      }}
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 shrink-0" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                  {isExpanded ? (
                    <div className="border-t border-border/70 px-2 pb-2 pt-1">
                      <HealthCheckDetailView
                        result={healthSnapshot?.latestResult ?? null}
                        liveProbes={healthSnapshot?.liveProbes ?? null}
                        isRunning={healthSnapshot?.running}
                        probeStates={healthSnapshot?.probeStates}
                        title="Device health detail"
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </AppSheetBody>
        </AppSheetContent>
      </AppSheet>
    </>
  );
}
