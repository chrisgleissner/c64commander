/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useHealthState } from "@/hooks/useHealthState";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import {
  HEALTH_GLYPHS,
  getBadgeAriaLabel,
  getBadgeConnectivityLabel,
  getBadgeHealthLabel,
  type ConnectivityState,
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
  const { state, connectivity, problemCount } = useHealthState();
  const { profile } = useDisplayProfile();

  const glyph = HEALTH_GLYPHS[state];
  const ariaLabel = getBadgeAriaLabel(state, connectivity, problemCount);
  const glyphColor = HEALTH_COLOR[state];
  const connectivityLabel = getBadgeConnectivityLabel(connectivity);
  const healthLabel = getBadgeHealthLabel(state, profile);
  const showsCount =
    problemCount > 0 && profile !== "expanded" && connectivity !== "Offline" && connectivity !== "Not yet connected";

  const handleClick = () => {
    requestDiagnosticsOpen("header");
  };

  return (
    <button
      type="button"
      role="button"
      aria-label={ariaLabel}
      data-testid="unified-health-badge"
      data-health-state={state}
      data-connectivity-state={connectivity}
      onClick={handleClick}
      className={cn(
        "flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1.5 min-h-[44px] min-w-[44px] touch-none",
        "border border-border hover:border-primary/60 transition-colors",
        className,
      )}
    >
      <span
        className="text-xs font-semibold leading-none tracking-wide uppercase shrink-0 text-foreground"
        aria-hidden="true"
      >
        {connectivity === "Not yet connected"
          ? profile === "compact"
            ? "—"
            : profile === "medium"
              ? "Not connected"
              : "Not yet connected"
          : connectivityLabel}
      </span>

      <span className={cn("font-mono text-base leading-none shrink-0", glyphColor)} aria-hidden="true">
        {glyph}
      </span>

      {showsCount && (
        <span className={cn("text-xs font-semibold leading-none shrink-0", glyphColor)} aria-hidden="true">
          {Math.min(problemCount, 99)}
        </span>
      )}

      {renderBadgeText(connectivity, problemCount, profile, healthLabel)}
    </button>
  );
}

/**
 * Renders the trailing neutral text after the health signal.
 */
function renderBadgeText(
  connectivity: ConnectivityState,
  problemCount: number,
  profile: "compact" | "medium" | "expanded",
  healthLabel: string | null,
): React.ReactNode {
  if (connectivity === "Offline") {
    return profile === "expanded" ? (
      <span
        className="text-xs font-semibold leading-none tracking-wide uppercase shrink-0 text-foreground"
        aria-hidden="true"
      >
        Device not reachable
      </span>
    ) : null;
  }

  if (connectivity === "Not yet connected") {
    return null;
  }

  if (healthLabel === null) {
    return null;
  }

  const problemSuffix =
    profile === "expanded" && problemCount > 0 ? ` · ${problemCount} problem${problemCount !== 1 ? "s" : ""}` : "";

  return (
    <span
      className="text-xs font-semibold leading-none tracking-wide uppercase shrink-0 text-foreground"
      aria-hidden="true"
    >
      {`${healthLabel}${problemSuffix}`}
    </span>
  );
}
