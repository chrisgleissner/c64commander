/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useRef, useState } from "react";

import {
  AppDialog,
  AppDialogBody,
  AppDialogContent,
  AppDialogDescription,
  AppDialogFooter,
  AppDialogHeader,
  AppDialogTitle,
} from "@/components/ui/app-surface";
import { Button } from "@/components/ui/button";
import { useHealthState } from "@/hooks/useHealthState";
import { useC64Connection } from "@/hooks/useC64Connection";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
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
  const longPressTimerRef = useRef<number | null>(null);
  const longPressHandledRef = useRef(false);
  const suppressClickRef = useRef(false);

  const canSwitchDevices = savedDevices.devices.length > 1;

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

      <AppDialog open={pickerOpen} onOpenChange={handlePickerOpenChange}>
        <AppDialogContent className="max-w-sm" data-testid="switch-device-dialog">
          <AppDialogHeader>
            <AppDialogTitle>Switch device</AppDialogTitle>
            <AppDialogDescription>Choose a saved device.</AppDialogDescription>
          </AppDialogHeader>
          <AppDialogBody className="space-y-2">
            {savedDevices.devices.map((device) => {
              const verified = savedDevices.verifiedByDeviceId[device.id] ?? null;
              const isSelected = device.id === savedDevices.selectedDeviceId;
              const status = isSelected ? getSavedDeviceSwitchStatus(device.id) : "last-known";
              const statusLabel = resolvePickerStatusLabel(status, isSelected);

              return (
                <button
                  key={device.id}
                  type="button"
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2 text-left transition-colors hover:bg-muted/40",
                    isSelected ? "border-primary/50 bg-primary/5" : "bg-background",
                  )}
                  onClick={() => {
                    void handleSwitchDevice(device.id);
                  }}
                  data-testid={`switch-device-row-${device.id}`}
                >
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">
                    {buildSavedDevicePrimaryLabel(device, verified)}
                  </span>
                  {statusLabel ? (
                    <span className="shrink-0 rounded-full border border-border/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {statusLabel}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </AppDialogBody>
          <AppDialogFooter>
            <Button type="button" variant="outline" onClick={() => setPickerOpen(false)}>
              Cancel
            </Button>
          </AppDialogFooter>
        </AppDialogContent>
      </AppDialog>
    </>
  );
}
