/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useHealthState } from "@/hooks/useHealthState";
import { useC64Connection } from "@/hooks/useC64Connection";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import {
  HEALTH_GLYPHS,
  getBadgeAriaLabel,
  getBadgeTextContract,
  type HealthState,
} from "@/lib/diagnostics/healthModel";
import { requestDiagnosticsOpen } from "@/lib/diagnostics/diagnosticsOverlay";
import { cn } from "@/lib/utils";

// §8.3 — Color classes per health state (shape is primary; color reinforces only)
const HEALTH_COLOR: Record<HealthState, string> = {
  Healthy: "text-success",
  Degraded: "text-amber-500",
  Unhealthy: "text-destructive",
  Idle: "text-muted-foreground",
  Unavailable: "text-muted-foreground",
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
  const {
    status: { state: rawConnectionState, deviceInfo },
  } = useC64Connection();
  const { profile } = useDisplayProfile();

  const glyph = HEALTH_GLYPHS[state];
  const ariaLabel = getBadgeAriaLabel(state, connectivity, problemCount, deviceInfo?.product);
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

  const handleClick = () => {
    requestDiagnosticsOpen("header");
  };

  return (
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
      onClick={handleClick}
      className={cn(
        "flex min-w-0 max-w-full items-center gap-1 overflow-hidden whitespace-nowrap rounded-lg px-2 py-1.5 min-h-[44px] touch-none",
        "border border-border hover:border-primary/60 transition-colors",
        className,
      )}
    >
      <span
        className="text-xs font-semibold leading-none tracking-wide uppercase shrink-0 text-foreground"
        data-overlay-critical="badge"
        aria-hidden="true"
      >
        {badgeText.leadingLabel}
      </span>

      <span
        className={cn("font-mono text-base leading-none shrink-0", glyphColor)}
        data-overlay-critical="badge"
        aria-hidden="true"
      >
        {badgeText.glyph}
      </span>

      {badgeText.countLabel && (
        <span
          className={cn("text-xs font-semibold leading-none shrink-0", glyphColor)}
          data-overlay-critical="badge"
          aria-hidden="true"
        >
          {badgeText.countLabel}
        </span>
      )}

      {badgeText.trailingLabel ? (
        <span
          className="min-w-0 truncate text-xs font-semibold leading-none tracking-wide uppercase text-foreground"
          data-overlay-critical="badge"
          aria-hidden="true"
        >
          {badgeText.trailingLabel}
        </span>
      ) : null}
    </button>
  );
}
