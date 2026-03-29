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
  );
}
