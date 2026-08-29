/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { subscribeDeviceSwitcherOpen } from "@/lib/input/keypadCommands";
import { HEALTH_CHECK_CONTEXTS, type HealthCheckRunResult } from "@/lib/diagnostics/healthCheckEngine";
import {
  HEALTH_GLYPHS,
  getBadgeAriaLabel,
  getBadgeTextContract,
  selectPreferredBadgeHealth,
  type HealthState,
} from "@/lib/diagnostics/healthModel";
import { requestDiagnosticsOpen } from "@/lib/diagnostics/diagnosticsOverlay";
import { discoverConnection } from "@/lib/connection/connectionManager";
import { addErrorLog } from "@/lib/logging";
import {
  buildSavedDevicePrimaryLabel,
  getSavedDeviceSwitchStatus,
  type DeviceSwitchStatus,
} from "@/lib/savedDevices/store";
import { handlePointerButtonClick } from "@/lib/ui/buttonInteraction";
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

const resolveDeviceSwitchStatusFromHealth = (
  snapshot: ReturnType<typeof useSavedDeviceHealthChecks>["byDeviceId"][string] | undefined,
): DeviceSwitchStatus | null => {
  if (!snapshot) return null;
  if (snapshot.running) return "verifying";
  if (snapshot.error) return "offline";
  const result = snapshot.latestResult;
  if (!result) return null;
  if (result.connectivity === "Offline" || result.overallHealth === "Unavailable") return "offline";
  return "connected";
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
  device: { lastSuccessfulConnectionAt?: string | null },
  isSelected: boolean,
) => {
  const switchPrefix = switchStatusLabel && switchStatusLabel !== "Selected" ? `${switchStatusLabel} selection` : null;
  const lastSeenAt = snapshot?.lastObservedAt ?? snapshot?.lastCompletedAt ?? device.lastSuccessfulConnectionAt ?? null;

  if (!snapshot) {
    return [switchPrefix, formatRelativeTime("Last seen", parseIsoTimestamp(lastSeenAt))].filter(Boolean).join(" · ");
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

  if (snapshot.deferredReason === "freshness") {
    return [
      switchPrefix,
      formatRelativeTime("Last seen", parseIsoTimestamp(lastSeenAt)),
      isSelected ? "Deferred" : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  if (snapshot.error) {
    return [
      switchPrefix,
      snapshot.deferredReason === "circuit-open" ? "Circuit open" : "Latest check failed",
      formatRelativeTime(
        snapshot.deferredReason === "circuit-open" ? "Last seen" : "Last check",
        parseIsoTimestamp(snapshot.deferredReason === "circuit-open" ? lastSeenAt : snapshot.lastCompletedAt),
      ),
    ]
      .filter(Boolean)
      .join(" · ");
  }

  return [switchPrefix, formatRelativeTime("Last check", parseIsoTimestamp(snapshot.lastCompletedAt ?? lastSeenAt))]
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
          <span className="truncate text-xs font-semibold uppercase tracking-[0.12em] text-foreground">
            {badgeText.leadingLabel}
          </span>
          <span className="shrink-0 whitespace-pre" aria-hidden="true">
            {" "}
          </span>
          <HealthStateShape state={healthState} className="text-[0.95rem]" />
          {badgeText.countLabel ? (
            <>
              <span className="shrink-0 whitespace-pre" aria-hidden="true">
                {" "}
              </span>
              <span className={cn("shrink-0 text-xs font-semibold leading-none", glyphColor)}>
                {badgeText.countLabel}
              </span>
            </>
          ) : null}
          {badgeText.trailingLabel ? (
            <>
              <span className="shrink-0 whitespace-pre" aria-hidden="true">
                {" "}
              </span>
              <span className="truncate text-xs font-semibold uppercase tracking-[0.12em] text-foreground">
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
  Degraded: "text-warning",
  Unhealthy: "text-destructive",
  Idle: "text-muted-foreground",
  Unavailable: "text-muted-foreground",
};

/**
 * The badge shape, drawn rather than typed.
 *
 * `HEALTH_GLYPHS` stays the model's word for each state — it is what `getBadgeLabel` and the
 * Diagnostics header put in a line of text — but the badge cannot render it as a character. The
 * five characters are drawn at wildly different sizes by whichever font supplies them, and Inter,
 * which the stack names first, ships with none of them. So the badge scaled the character up to
 * an optical size measured against one machine's fallback font. On the font CI and the Android
 * WebView actually fall back to, `●` fills its em box, and 1.42× of that overflowed the row on
 * every side; the row clips its overflow, so the circle was drawn with its top and both sides
 * sliced off. An SVG is the same size on every device and never leaves its own box.
 */
const HEALTH_SHAPE: Record<HealthState, ReactNode> = {
  Healthy: <circle cx="12" cy="12" r="8" fill="currentColor" />,
  Degraded: <path d="M12 3.2 21.6 20.4H2.4Z" fill="currentColor" />,
  Unhealthy: <path d="M12 2.6 21.4 12 12 21.4 2.6 12Z" fill="currentColor" />,
  Idle: <circle cx="12" cy="12" r="7.2" fill="none" stroke="currentColor" strokeWidth="2.4" />,
  Unavailable: (
    <circle
      cx="12"
      cy="12"
      r="7.2"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeDasharray="0.1 5.2"
    />
  ),
};

function HealthStateShape({
  state,
  className,
  overlayCritical = false,
}: {
  state: HealthState;
  className?: string;
  /** Marks the shape for the overlay audit, which checks nothing covers the badge. */
  overlayCritical?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("h-[1.25em] w-[1.25em] shrink-0", HEALTH_COLOR[state], className)}
      aria-hidden="true"
      focusable="false"
      data-health-shape={state}
      data-overlay-critical={overlayCritical ? "badge" : undefined}
    >
      {HEALTH_SHAPE[state]}
    </svg>
  );
}

type Props = {
  className?: string;
};

type PendingSwitchState = {
  fromDeviceId: string;
  toDeviceId: string;
};

/**
 * Unified header badge (§8).
 *
 * Shape encodes health state; text label encodes connectivity.
 * Tapping opens the diagnostics overlay (§8.9).
 */
export function UnifiedHealthBadge({ className }: Props) {
  const healthState = useHealthState();
  const savedDevices = useSavedDevices();
  const switchSavedDevice = useSavedDeviceSwitching();
  const {
    status: { state: rawConnectionState, deviceInfo },
  } = useC64Connection();
  const { profile } = useDisplayProfile();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [expandedDeviceIds, setExpandedDeviceIds] = useState<string[]>([]);
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitchState | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressHandledRef = useRef(false);
  const suppressClickRef = useRef(false);

  const canSwitchDevices = savedDevices.devices.length > 1;
  // HARD19-034 (decision D6): run saved-device health checks whenever more than
  // one device is saved — not only while the picker is open. With the picker
  // closed this drives the F-DIAG-1 `backgroundMaintenance` mode (selected-device
  // only, freshness-gated, circuit-open-deferred, visibility-resume), which was
  // previously dead code because `enabled` was false in exactly that mode. The
  // context split is unchanged, so the picker still gets the fuller
  // `switchDeviceDialog` behaviour when open. The hook's existing freshness /
  // circuit gates bound the added background probe traffic.
  const shouldRunSavedDeviceHealthChecks = canSwitchDevices;
  const {
    byDeviceId: healthByDeviceId,
    refreshAll,
    totalProbeCount,
  } = useSavedDeviceHealthChecks(
    savedDevices.devices,
    shouldRunSavedDeviceHealthChecks,
    pickerOpen ? HEALTH_CHECK_CONTEXTS.switchDeviceDialog : HEALTH_CHECK_CONTEXTS.backgroundMaintenance,
    savedDevices.selectedDeviceId,
  );

  const shouldPreferSelectedDeviceEvidence = pickerOpen || pendingSwitch !== null;
  const selectedDeviceHealthSnapshot = shouldPreferSelectedDeviceEvidence
    ? ((savedDevices.selectedDeviceId ? healthByDeviceId[savedDevices.selectedDeviceId] : null) ?? null)
    : null;
  const { state, connectivity, problemCount } = useMemo(
    () =>
      selectPreferredBadgeHealth(
        {
          state: healthState.state,
          connectivity: healthState.connectivity,
          problemCount: healthState.problemCount,
        },
        selectedDeviceHealthSnapshot
          ? {
              running: selectedDeviceHealthSnapshot.running,
              latestResult: selectedDeviceHealthSnapshot.latestResult,
            }
          : null,
      ),
    [healthState.connectivity, healthState.problemCount, healthState.state, selectedDeviceHealthSnapshot],
  );
  const { connectedDeviceLabel } = healthState;

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
      setPendingSwitch(null);
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

  // Keypad equivalent of the long-press: a global `#` / quick-menu command opens
  // the same Device Switcher (it self-gates on having more than one saved device).
  useEffect(() => subscribeDeviceSwitcherOpen(openSwitchPicker), [openSwitchPicker]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (canSwitchDevices && event.pointerType === "touch") {
        event.preventDefault();
      }
      if (!canSwitchDevices) return;
      longPressHandledRef.current = false;
      suppressClickRef.current = false;
      clearLongPress();
      longPressTimerRef.current = window.setTimeout(() => {
        openSwitchPicker();
      }, BADGE_LONG_PRESS_MS);
    },
    [canSwitchDevices, clearLongPress, openSwitchPicker],
  );

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (suppressClickRef.current || longPressHandledRef.current) {
        event.preventDefault();
        suppressClickRef.current = false;
        longPressHandledRef.current = false;
        return;
      }
      handlePointerButtonClick(event);
      // When the device is offline, a tap actively kicks off a reconnect in
      // addition to opening Diagnostics. The passive background re-probe can be
      // slow to recover when the device was unreachable at app launch, so this
      // gives the user an immediate, obvious recovery affordance. In the Auth
      // sub-case (device reachable but rejected the password) the same manual
      // probe re-hits the 401/403 and re-raises the password prompt via
      // notifyAuthRequired (HARD9-001), so the badge tap is the recovery path.
      if (connectivity === "Offline" || connectivity === "Auth") {
        void discoverConnection("manual");
      }
      requestDiagnosticsOpen("header");
    },
    [connectivity],
  );

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
      const fromDeviceId = pendingSwitch?.fromDeviceId ?? savedDevices.selectedDeviceId;

      if (deviceId === fromDeviceId) {
        setPickerOpen(false);
        return;
      }

      setPendingSwitch({ fromDeviceId, toDeviceId: deviceId });
      setPickerOpen(false);

      void switchSavedDevice(deviceId)
        .catch((error) => {
          addErrorLog("Saved device switch failed", {
            deviceId,
            error: (error as Error).message,
          });
        })
        .finally(() => {
          setPendingSwitch(null);
        });
    },
    [pendingSwitch?.fromDeviceId, savedDevices.selectedDeviceId, switchSavedDevice],
  );

  const pickerSelectedDeviceId = pendingSwitch?.toDeviceId ?? savedDevices.selectedDeviceId;

  return (
    <>
      <button
        type="button"
        role="button"
        aria-label={ariaLabel}
        data-testid="unified-health-badge"
        data-diagnostics-open-trigger="true"
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
        onContextMenu={(event) => {
          event.preventDefault();
          openSwitchPicker();
        }}
        onClick={handleClick}
        className={cn(
          "app-chrome-badge inline-flex shrink min-w-0 select-none items-center overflow-hidden rounded-md bg-transparent px-0 py-0 touch-none",
          // 44px on every profile. A pseudo-element was tried here to keep the pressable area while
          // letting the header be shorter, but the box a finger and an automated reach check both
          // measure is this one, so the floor has to be real rather than implied.
          "min-h-[44px]",
          // Compact shows the status glyph alone, which without a floor drew a 33px-wide target.
          // The other profiles show the host name and need `min-w-0` so it can truncate instead of
          // pushing the title out — they are comfortably past 44px on their own content.
          profile === "compact" ? "min-w-[44px] justify-center max-w-[min(48vw,12rem)]" : "min-w-0 max-w-full",
          "text-foreground transition-opacity hover:opacity-90 active:opacity-80",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-0",
          className,
        )}
        style={{ WebkitTouchCallout: "none" }}
      >
        <span
          className="app-chrome-badge-surface inline-flex min-w-0 max-w-full select-none items-center overflow-hidden rounded-md px-2 py-[0.3rem]"
          aria-hidden="true"
        >
          <span className="inline-flex min-w-0 max-w-full select-none items-center overflow-hidden whitespace-nowrap leading-none">
            {/*
              The host name is dropped on a narrow screen. At 320 px it took 154 px — 48% of the
              header — to render "192.168.1.148" truncated to "192.168.1…", which names nothing. The
              glyph is what this badge is for, and the host is on Home's system row and in Settings
              for anyone who wants it.

              The threshold is viewport width rather than display profile, because what decides
              whether the host fits is how many pixels the header has to share between the page
              title, the host and the status word. A 393 px phone is on the medium profile and drew
              all three truncated at once — "SETTIN…", "192.168.1.…", "HEALT…". Hidden in CSS
              (`app-chrome-badge-host`) so the breakpoint lives beside the other header rules
              instead of being duplicated as a width listener here.
            */}
            {profile === "compact" ? null : (
              <>
                <span
                  className="app-chrome-badge-host truncate text-xs font-semibold uppercase tracking-[0.14em] text-foreground"
                  data-overlay-critical="badge"
                >
                  {badgeText.leadingLabel}
                </span>
                <span className="app-chrome-badge-host shrink-0 whitespace-pre" aria-hidden="true">
                  {" "}
                </span>
              </>
            )}
            <HealthStateShape state={state} className="text-[1rem]" overlayCritical />
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
                <span className="app-chrome-badge-status shrink-0 whitespace-pre" aria-hidden="true">
                  {" "}
                </span>
                {/*
                  Dropped on a narrow header, like the host above it. "UNHEALTHY" is nine wide
                  letters and it is the third thing saying the same as the glyph's colour and the
                  problem count beside it, so on a phone it spends the page title's width to repeat
                  what is already on screen. Hidden in CSS (`app-chrome-badge-status`) rather than
                  by asking for the compact contract, so the model still describes what the badge
                  means and the header decides what it has room to draw.
                */}
                <span
                  className="app-chrome-badge-status truncate text-xs font-semibold uppercase tracking-[0.14em] text-foreground"
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
              const isSelected = device.id === pickerSelectedDeviceId;
              const isPendingTarget = pendingSwitch?.toDeviceId === device.id;
              const healthSnapshot = healthByDeviceId[device.id];
              const status = isPendingTarget
                ? "verifying"
                : (resolveDeviceSwitchStatusFromHealth(healthSnapshot) ?? getSavedDeviceSwitchStatus(device.id));
              const statusLabel = resolvePickerStatusLabel(status, isSelected);
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
                            <span className="shrink-0 rounded-full border border-border/70 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                              {statusLabel}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {resolveDeviceHealthSummary(healthSnapshot, totalProbeCount, statusLabel, device, isSelected)}
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
