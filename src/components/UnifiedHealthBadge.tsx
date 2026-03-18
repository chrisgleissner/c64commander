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

// Connectivity label color
const CONN_COLOR: Record<ConnectivityState, string> = {
  Online: "text-success",
  Demo: "text-amber-500",
  Offline: "text-destructive",
  "Not yet connected": "text-muted-foreground",
  Checking: "text-muted-foreground",
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
  const connColor = CONN_COLOR[connectivity];

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
        "flex items-center gap-0.5 whitespace-nowrap rounded-lg px-2 py-1.5 min-h-[44px] min-w-[44px] touch-none",
        "border border-border hover:border-primary/60 transition-colors",
        className,
      )}
    >
      {/* Glyph: encodes health state */}
      <span className={cn("font-mono text-base leading-none shrink-0", glyphColor)} aria-hidden="true">
        {glyph}
      </span>

      {/* Count digit(s): shown when problems exist and profile is compact/medium */}
      {problemCount > 0 && profile !== "expanded" && (
        <span className={cn("text-xs font-semibold leading-none shrink-0", glyphColor)} aria-hidden="true">
          {Math.min(problemCount, 99)}
        </span>
      )}

      {/* Connectivity label (and health label for medium/expanded) */}
      <span
        className={cn(
          "text-xs font-semibold leading-none tracking-wide uppercase shrink-0",
          // For offline/not-connected, use connectivity color; otherwise split rendering below
          connectivity === "Offline" || connectivity === "Not yet connected" ? connColor : "",
        )}
        aria-hidden="true"
      >
        {renderBadgeText(state, connectivity, problemCount, profile, connColor)}
      </span>
    </button>
  );
}

/**
 * Renders the text portion of the badge (everything after the glyph span).
 * Inline rendering to allow different colors for health vs connectivity parts.
 */
function renderBadgeText(
  health: HealthState,
  connectivity: ConnectivityState,
  problemCount: number,
  profile: "compact" | "medium" | "expanded",
  connColor: string,
): React.ReactNode {
  const connLabel =
    connectivity === "Online"
      ? "C64U"
      : connectivity === "Demo"
        ? "Demo"
        : connectivity === "Offline"
          ? "Offline"
          : connectivity === "Not yet connected"
            ? "—"
            : "C64U"; // Checking: retain previous visual

  if (connectivity === "Offline") {
    return profile === "expanded" ? <> Offline · Device not reachable</> : <> Offline</>;
  }

  if (connectivity === "Not yet connected") {
    if (profile === "compact") return <> —</>;
    if (profile === "medium") return <> Not connected</>;
    return <> Not yet connected</>;
  }

  if (profile === "compact") {
    // Count is rendered by the standalone count span in the badge layout — omit here
    return (
      <>
        {" "}
        <span className={connColor}>{connLabel}</span>
      </>
    );
  }

  const healthLabel =
    health === "Unavailable"
      ? "?"
      : health === "Idle"
        ? "Idle"
        : health === "Healthy"
          ? "Healthy"
          : health === "Degraded"
            ? "Degraded"
            : "Unhealthy";

  if (profile === "medium") {
    // Count is rendered by the standalone count span in the badge layout — omit here
    return (
      <>
        {" "}
        <span>{healthLabel}</span>
        {" · "}
        <span className={connColor}>{connLabel}</span>
      </>
    );
  }

  // expanded
  const problemSuffix = problemCount > 0 ? ` · ${problemCount} problem${problemCount !== 1 ? "s" : ""}` : "";
  return (
    <>
      {" "}
      <span>{`${healthLabel}${problemSuffix}`}</span>
      {" · "}
      <span className={connColor}>{connLabel}</span>
    </>
  );
}
