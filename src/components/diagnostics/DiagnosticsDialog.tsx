/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  AppSheet,
  AppSheetContent,
  AppSheetDescription,
  AppSheetHeader,
  AppSheetTitle,
} from "@/components/ui/app-surface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionSummaryListItem } from "@/components/diagnostics/ActionSummaryListItem";
import { DiagnosticsListItem } from "@/components/diagnostics/DiagnosticsListItem";
import {
  ConnectionActionsRegion,
  isRecoveryFirstState,
  type ConnectionActionsCallbacks,
} from "@/components/diagnostics/ConnectionActionsRegion";
import { ConfigDriftView } from "@/components/diagnostics/ConfigDriftView";
import { DeviceDetailView, type DeviceDetailInfo } from "@/components/diagnostics/DeviceDetailView";
import { HealthCheckDetailView } from "@/components/diagnostics/HealthCheckDetailView";
import { LatencyAnalysisPopup } from "@/components/diagnostics/LatencyAnalysisPopup";
import { HealthHistoryPopup } from "@/components/diagnostics/HealthHistoryPopup";
import { HeatMapPopup } from "@/components/diagnostics/HeatMapPopup";
import type { HeatMapVariant } from "@/lib/diagnostics/heatMapData";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import type { ActionSummary } from "@/lib/diagnostics/actionSummaries";
import {
  HEALTH_GLYPHS,
  getContributorSupportingPhrase,
  type ConnectivityState,
  type ContributorKey,
  type HealthState,
  type LastActivity,
  type OverallHealthState,
  type Problem,
} from "@/lib/diagnostics/healthModel";
import { computeLatencyPercentiles } from "@/lib/diagnostics/latencyTracker";
import { resolveLogSeverity, resolveTraceSeverity } from "@/lib/diagnostics/diagnosticsSeverity";
import { formatDiagnosticsTimestamp } from "@/lib/diagnostics/timeFormat";
import { getTraceTitle } from "@/lib/tracing/traceFormatter";
import { cn } from "@/lib/utils";
import {
  Activity,
  BarChart2,
  ChevronDown,
  ChevronUp,
  Clock,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// §11 — Evidence type filters
export type EvidenceType = "Problems" | "Actions" | "Logs" | "Traces";

// §12.4 — Health indicator filter
export type IndicatorFilter = ContributorKey | "All";

// §12.5 — Origin filters
export type OriginFilter = "User" | "System";

type DiagnosticsLogEntry = {
  id: string;
  level?: string;
  message: string;
  timestamp: string;
  details?: unknown;
};

type DiagnosticsTraceEntry = {
  id: string;
  timestamp: string;
  [key: string]: unknown;
};

type ActivePopup = "latency" | "history" | `heatmap-${"REST" | "FTP" | "CONFIG"}` | null;
type ActiveDetailView = "device" | "config-drift" | "health-check" | null;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  healthState: OverallHealthState;
  // Entry data
  logs: DiagnosticsLogEntry[];
  errorLogs: DiagnosticsLogEntry[];
  traceEvents: DiagnosticsTraceEntry[];
  actionSummaries: ActionSummary[];
  // Actions
  onShareAll: () => void | Promise<void>;
  onShareFiltered: (
    entries: Array<DiagnosticsLogEntry | ActionSummary | DiagnosticsTraceEntry>,
  ) => void | Promise<void>;
  onClearAll: () => void;
  /** Legacy simple retry — called when no async feedback is needed */
  onRetryConnection: () => void;
  // §11.2 — Default filter state on open (driven by entry preset)
  defaultEvidenceTypes?: Set<EvidenceType>;
  // §7/8 — Extended connection action callbacks (async, with inline feedback)
  connectionCallbacks?: ConnectionActionsCallbacks;
  // §14 — Device detail from last health check
  deviceInfo?: DeviceDetailInfo | null;
  // §5 — Whether a health check is currently running
  healthCheckRunning?: boolean;
  onRunHealthCheck?: () => void;
  lastHealthCheckResult?: import("@/lib/diagnostics/healthCheckEngine").HealthCheckRunResult | null;
  liveHealthCheckProbes?: Partial<
    Record<
      import("@/lib/diagnostics/healthCheckEngine").HealthCheckProbeType,
      import("@/lib/diagnostics/healthCheckEngine").HealthCheckProbeRecord
    >
  > | null;
};

const CONTRIBUTOR_ORDER: ContributorKey[] = ["App", "REST", "FTP"];

const PAGE_SIZE = 200;

// §7.1 — Health state color classes
const HEALTH_STATE_COLOR: Record<HealthState, string> = {
  Healthy: "text-success",
  Degraded: "text-amber-500",
  Unhealthy: "text-destructive",
  Idle: "text-muted-foreground",
  Unavailable: "text-muted-foreground",
};

// Connectivity label colors
const CONN_COLOR: Record<ConnectivityState, string> = {
  Online: "text-success",
  Demo: "text-amber-500",
  Offline: "text-destructive",
  "Not yet connected": "text-muted-foreground",
  Checking: "text-muted-foreground",
};

const formatRelative = (timestampMs: number): string => {
  const elapsed = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (elapsed < 60) return `${elapsed}s ago`;
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return `${m}m ${s}s ago`;
};

const normalizeFilter = (v: string) => v.trim().toLowerCase();

const matchesFilter = (filterText: string, fields: Array<string | null | undefined>): boolean => {
  const norm = normalizeFilter(filterText);
  if (!norm) return true;
  return fields.filter(Boolean).join(" ").toLowerCase().includes(norm);
};

const connLabel = (connectivity: ConnectivityState): string =>
  connectivity === "Online" ? "C64U" : connectivity === "Demo" ? "Demo" : connectivity === "Offline" ? "Offline" : "—";

// §10.4 — Explanation phrase for non-Healthy overall health
const getExplanationPhrase = (
  state: HealthState,
  contributors: OverallHealthState["contributors"],
  profile: "compact" | "medium" | "expanded",
): string | null => {
  if (state === "Healthy" || state === "Idle") return null;
  if (state === "Unavailable") return "Health data unavailable";

  const phrases: string[] = [];
  if (contributors.REST.state === "Unhealthy" || contributors.REST.state === "Degraded")
    phrases.push("REST failures detected");
  if (contributors.FTP.state === "Unhealthy" || contributors.FTP.state === "Degraded")
    phrases.push("FTP failures detected");
  if (contributors.App.state === "Unhealthy" || contributors.App.state === "Degraded")
    phrases.push("App problems detected");
  if (phrases.length === 0) return null;

  const full = phrases.join(", ");
  const maxLen = profile === "compact" ? 50 : profile === "medium" ? 80 : 200;
  return full.length > maxLen ? full.slice(0, maxLen - 1) + "…" : full;
};

// §10.3 — Collapsed summary row
const CollapsedSummaryRow = ({
  health,
  connectivity,
  onExpand,
}: {
  health: HealthState;
  connectivity: ConnectivityState;
  onExpand: () => void;
}) => {
  const glyph = HEALTH_GLYPHS[health];
  return (
    <button
      type="button"
      onClick={onExpand}
      className="flex w-full items-center justify-between gap-2 px-1 py-1 text-sm font-medium"
      aria-label="Expand health summary"
    >
      <span className="flex items-center gap-1.5">
        <span className={cn("font-mono text-base leading-none", HEALTH_STATE_COLOR[health])}>{glyph}</span>
        <span>{health}</span>
        <span className="text-muted-foreground">·</span>
        <span className={CONN_COLOR[connectivity]}>{connLabel(connectivity)}</span>
      </span>
      <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
    </button>
  );
};

// §10.5 — Last activity row
const LastActivityRow = ({
  label,
  activity,
  profile,
}: {
  label: string;
  activity: LastActivity | null;
  profile: "compact" | "medium" | "expanded";
}) => {
  const empty = label === "REST" ? "No REST activity yet" : "No FTP activity yet";
  if (!activity) {
    return (
      <p className="text-xs text-muted-foreground">
        <span className="font-medium">{label}:</span> {empty}
      </p>
    );
  }
  const relative = formatRelative(activity.timestampMs);
  const absolute =
    profile === "expanded" ? ` (${formatDiagnosticsTimestamp(new Date(activity.timestampMs).toISOString())})` : "";
  const maxLen = profile === "compact" ? 40 : undefined;
  const op = maxLen ? activity.operation.slice(0, maxLen) : activity.operation;
  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-medium">{label}:</span> <span className="font-mono">{op}</span>
      {" · "}
      <span>{activity.result}</span>
      {" · "}
      <span>{relative}</span>
      {absolute}
    </p>
  );
};

// §10.6 — Contributor row
const ContributorRow = ({
  contributorKey,
  health,
  isActive,
  onClick,
  profile,
}: {
  contributorKey: ContributorKey;
  health: OverallHealthState["contributors"][ContributorKey];
  isActive: boolean;
  onClick: () => void;
  profile: "compact" | "medium" | "expanded";
}) => {
  const glyph = HEALTH_GLYPHS[health.state];
  const phrase = getContributorSupportingPhrase(contributorKey, health);
  const maxPhrase = profile === "compact" ? 30 : profile === "medium" ? 50 : undefined;
  const displayPhrase = maxPhrase ? phrase.slice(0, maxPhrase) : phrase;
  // §10.6 — Expanded profile adds session totals
  const sessionTotal =
    profile === "expanded" && health.totalOperations > 0 ? ` · ${health.totalOperations} session total` : "";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-xs hover:bg-muted/50 transition-colors",
        isActive && "bg-muted",
      )}
      aria-pressed={isActive}
      data-testid={`contributor-row-${contributorKey.toLowerCase()}`}
    >
      <span className="flex items-center gap-1.5">
        <span className={cn("font-mono leading-none", HEALTH_STATE_COLOR[health.state])} aria-hidden="true">
          {glyph}
        </span>
        <span className="font-medium">{contributorKey}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">{health.state}</span>
      </span>
      <span className="text-muted-foreground truncate">
        {displayPhrase}
        {sessionTotal}
      </span>
    </button>
  );
};

// §10.8 — Primary problem spotlight
const PrimaryProblemSpotlight = ({ problem, onSelect }: { problem: Problem; onSelect: () => void }) => (
  <button
    type="button"
    onClick={onSelect}
    className="w-full text-left rounded border border-destructive/30 bg-destructive/5 px-2 py-1.5 hover:bg-destructive/10 transition-colors"
    data-testid="primary-problem-spotlight"
  >
    <p className="text-xs font-semibold text-destructive uppercase tracking-wide mb-0.5">Investigate now</p>
    <p className="text-sm font-medium truncate">{problem.title.slice(0, 60)}</p>
    {problem.causeHint && <p className="text-xs text-muted-foreground truncate">{problem.causeHint.slice(0, 40)}</p>}
    <p className="text-xs text-muted-foreground mt-0.5">{problem.contributor}</p>
  </button>
);

// §10 — Collapsible health summary
const HealthSummary = ({
  healthState,
  indicatorFilter,
  onIndicatorFilterChange,
  onRetryConnection,
  onSpotlightSelect,
  isCompact,
  profile,
  expanded,
  onExpandedChange,
  connectionCallbacks,
  deviceInfo,
  healthCheckRunning,
  onRunHealthCheck,
  onOpenDeviceDetail,
  onOpenLatency,
  onOpenHistory,
  lastHealthCheckResult,
  onOpenHealthCheckDetail,
}: {
  healthState: OverallHealthState;
  indicatorFilter: IndicatorFilter;
  onIndicatorFilterChange: (f: IndicatorFilter) => void;
  onRetryConnection: () => void;
  onSpotlightSelect: () => void;
  isCompact: boolean;
  profile: "compact" | "medium" | "expanded";
  expanded: boolean;
  onExpandedChange: (v: boolean) => void;
  connectionCallbacks?: ConnectionActionsCallbacks;
  deviceInfo?: DeviceDetailInfo | null;
  healthCheckRunning?: boolean;
  onRunHealthCheck?: () => void;
  onOpenDeviceDetail: () => void;
  onOpenLatency: () => void;
  onOpenHistory: () => void;
  lastHealthCheckResult?: import("@/lib/diagnostics/healthCheckEngine").HealthCheckRunResult | null;
  onOpenHealthCheckDetail: () => void;
}) => {
  const { state, connectivity, host, contributors, lastRestActivity, lastFtpActivity, primaryProblem } = healthState;
  const glyph = HEALTH_GLYPHS[state];
  // §7.2 — Show legacy retry only when connection callbacks are not provided
  const showLegacyRetry = !connectionCallbacks && (connectivity === "Offline" || connectivity === "Not yet connected");
  const explanation = getExplanationPhrase(state, contributors, profile);

  // §6.3 — Recovery-first: auto-expand Connection Actions when offline/disconnected
  const recoveryFirst = isRecoveryFirstState(connectivity);

  // Latency summary
  const latency = computeLatencyPercentiles();
  const hasLatencyData = latency.sampleCount > 0;

  return (
    <div
      className={cn("border-b border-border", isCompact ? "px-3 pb-2 pt-1.5" : "px-4 pb-3 pt-2")}
      data-testid="health-summary"
    >
      {/* Collapse toggle row */}
      {expanded ? (
        <button
          type="button"
          onClick={() => onExpandedChange(false)}
          className="flex w-full items-center justify-between gap-2 mb-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Collapse health summary"
        >
          <span className="font-medium uppercase tracking-wide">Health summary</span>
          <ChevronUp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </button>
      ) : (
        <CollapsedSummaryRow health={state} connectivity={connectivity} onExpand={() => onExpandedChange(true)} />
      )}

      {expanded && (
        <div className="space-y-2">
          {/* §10.4 — Overall health row (tappable → device detail) */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onIndicatorFilterChange("All")}
              className={cn(
                "flex flex-1 items-center justify-between gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted/50 transition-colors",
                indicatorFilter === "All" && "bg-muted",
              )}
              aria-pressed={indicatorFilter === "All"}
              data-testid="overall-health-row"
            >
              <span className="flex items-center gap-1.5 flex-wrap">
                <span className={cn("font-mono text-base leading-none", HEALTH_STATE_COLOR[state])} aria-hidden="true">
                  {glyph}
                </span>
                <span className="font-medium">Overall health</span>
                <span className="text-muted-foreground">·</span>
                <span className={cn("font-medium", HEALTH_STATE_COLOR[state])}>{state}</span>
                <span className="text-muted-foreground">·</span>
                <span className={cn("font-medium", CONN_COLOR[connectivity])}>{connLabel(connectivity)}</span>
              </span>
            </button>
            {/* §14 — Device detail shortcut */}
            <button
              type="button"
              onClick={onOpenDeviceDetail}
              className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              aria-label="Device firmware and uptime detail"
              data-testid="open-device-detail"
            >
              <Activity className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          {/* §10.4 — Explanation phrase */}
          {explanation && (
            <p className="text-xs text-muted-foreground px-1" data-testid="health-explanation">
              {explanation}
            </p>
          )}

          {/* Host (read-only, expanded profile only) */}
          {profile === "expanded" && (
            <p className="text-xs text-muted-foreground px-1">
              Host: <span className="font-mono">{host}</span>
            </p>
          )}

          {/* §10.5 — Last activity rows */}
          <div className="space-y-0.5 px-1">
            <LastActivityRow label="REST" activity={lastRestActivity} profile={profile} />
            <LastActivityRow label="FTP" activity={lastFtpActivity} profile={profile} />
          </div>

          {/* §10.6 — Contributor rows */}
          <div className="space-y-0.5">
            {CONTRIBUTOR_ORDER.map((key) => (
              <ContributorRow
                key={key}
                contributorKey={key}
                health={contributors[key]}
                isActive={indicatorFilter === key}
                onClick={() => onIndicatorFilterChange(indicatorFilter === key ? "All" : key)}
                profile={profile}
              />
            ))}
          </div>

          {/* §10.8 — Primary problem spotlight */}
          {primaryProblem && <PrimaryProblemSpotlight problem={primaryProblem} onSelect={onSpotlightSelect} />}

          {/* §12.2 — Latency summary (tappable → latency popup) */}
          {hasLatencyData && (
            <button
              type="button"
              onClick={onOpenLatency}
              className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              data-testid="latency-summary-row"
            >
              <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span>
                P50 <span className="font-mono">{latency.p50}ms</span>
                {" · "}P90 <span className="font-mono">{latency.p90}ms</span>
                {" · "}P99 <span className="font-mono">{latency.p99}ms</span>
              </span>
              <span className="ml-auto text-[10px] underline">Analyse</span>
            </button>
          )}

          {/* §13 — Health history shortcut */}
          <button
            type="button"
            onClick={onOpenHistory}
            className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            data-testid="health-history-row"
          >
            <BarChart2 className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span>Health history</span>
          </button>

          {/* §11.2 — Run health check */}
          {onRunHealthCheck && (
            <div className="space-y-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={onRunHealthCheck}
                disabled={healthCheckRunning}
                className="w-full"
                data-testid="run-health-check-button"
              >
                {healthCheckRunning ? "Running health check…" : "Run health check"}
              </Button>
              {lastHealthCheckResult && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onOpenHealthCheckDetail}
                  className="w-full"
                  data-testid="open-health-check-detail"
                >
                  Last health check
                </Button>
              )}
            </div>
          )}

          {/* §10.9 — Legacy retry (when no connectionCallbacks provided) */}
          {showLegacyRetry && (
            <div className="space-y-1 pt-0.5">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onRetryConnection}
                  disabled={connectivity === "Checking"}
                  data-testid="retry-connection-button"
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                  Retry connection
                </Button>
                <span className="text-xs text-muted-foreground font-mono">{host}</span>
              </div>
              {/* §10.9 — Change host link */}
              <p className="text-xs text-muted-foreground px-1">
                <a
                  href="/settings"
                  className="underline hover:text-foreground transition-colors"
                  data-testid="change-host-settings-link"
                >
                  Change host in Settings
                </a>
              </p>
            </div>
          )}

          {/* §7 / §8 — Connection actions region (replaces legacy retry when callbacks provided) */}
          {connectionCallbacks && (
            <ConnectionActionsRegion
              connectivity={connectivity}
              currentHost={host}
              callbacks={connectionCallbacks}
              defaultExpanded={recoveryFirst}
            />
          )}
        </div>
      )}
    </div>
  );
};

// §11 — Quick-focus toggle controls
const QuickFocusControls = ({
  activeTypes,
  onToggle,
  searchText,
  onSearchChange,
  originFilters,
  onOriginToggle,
  isCompact,
  isMedium,
  refineCount,
}: {
  activeTypes: Set<EvidenceType>;
  onToggle: (t: EvidenceType) => void;
  searchText: string;
  onSearchChange: (v: string) => void;
  originFilters: Set<OriginFilter>;
  onOriginToggle: (o: OriginFilter) => void;
  isCompact: boolean;
  isMedium: boolean;
  refineCount: number;
}) => {
  const [refineOpen, setRefineOpen] = useState(false);
  const types: EvidenceType[] = ["Problems", "Actions", "Logs", "Traces"];
  const origins: OriginFilter[] = ["User", "System"];

  // §11.3 — Compact: search + origin behind Refine; Medium: origin behind Refine; Expanded: all visible
  const showRefineButton = isCompact || isMedium;
  const showSearchInline = !isCompact;
  const showOriginInline = !isCompact && !isMedium;

  return (
    <div
      className={cn("shrink-0 border-b border-border space-y-1.5", isCompact ? "px-3 pb-1.5 pt-1" : "px-4 pb-2 pt-1.5")}
    >
      {/* Evidence type toggles */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {types.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onToggle(t)}
            aria-pressed={activeTypes.has(t)}
            data-testid={`evidence-toggle-${t.toLowerCase()}`}
            className={cn(
              "px-2.5 py-0.5 text-xs font-medium rounded border transition-colors",
              activeTypes.has(t)
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary/40",
            )}
          >
            {t}
          </button>
        ))}
        {/* §11.3 — Refine button */}
        {showRefineButton && (
          <button
            type="button"
            onClick={() => setRefineOpen((v) => !v)}
            aria-pressed={refineOpen}
            data-testid="refine-button"
            className={cn(
              "px-2.5 py-0.5 text-xs font-medium rounded border transition-colors ml-auto",
              refineOpen
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary/40",
            )}
          >
            <SlidersHorizontal className="h-3 w-3 inline-block mr-1" aria-hidden="true" />
            Refine{refineCount > 0 ? ` (${refineCount})` : ""}
          </button>
        )}
      </div>

      {/* §11.3 — Origin filters (inline on expanded) */}
      {showOriginInline && (
        <div className="flex items-center gap-1.5">
          {origins.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => onOriginToggle(o)}
              aria-pressed={originFilters.has(o)}
              data-testid={`origin-toggle-${o.toLowerCase()}`}
              className={cn(
                "px-2 py-0.5 text-xs font-medium rounded border transition-colors",
                originFilters.has(o)
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/40",
              )}
            >
              {o}
            </button>
          ))}
        </div>
      )}

      {/* Search (inline on medium+) */}
      {showSearchInline && (
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
            aria-hidden="true"
          />
          <Input
            type="text"
            placeholder="Filter entries"
            value={searchText}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 pr-9 h-8 text-xs"
            data-testid="diagnostics-filter-input"
          />
          {searchText && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSearchChange("")}
              className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
              aria-label="Clear filter"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      )}

      {/* Refine expanded panel (compact: search + origin; medium: origin) */}
      {showRefineButton && refineOpen && (
        <div className="space-y-1.5 pt-1" data-testid="refine-panel">
          {isCompact && (
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
                aria-hidden="true"
              />
              <Input
                type="text"
                placeholder="Filter entries"
                value={searchText}
                onChange={(e) => onSearchChange(e.target.value)}
                className="pl-9 pr-9 h-8 text-xs"
                data-testid="diagnostics-filter-input"
              />
              {searchText && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onSearchChange("")}
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
                  aria-label="Clear filter"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          )}
          <div className="flex items-center gap-1.5">
            {origins.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => onOriginToggle(o)}
                aria-pressed={originFilters.has(o)}
                data-testid={`origin-toggle-${o.toLowerCase()}`}
                className={cn(
                  "px-2 py-0.5 text-xs font-medium rounded border transition-colors",
                  originFilters.has(o)
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40",
                )}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// §12.4 — Determine contributor for a trace entry type
const traceContributor = (entry: DiagnosticsTraceEntry): ContributorKey | null => {
  const type = entry.type as string | undefined;
  if (type === "rest-request" || type === "rest-response") return "REST";
  if (type === "ftp-operation") return "FTP";
  if (type === "error") return "App";
  return null;
};

// §13.3 — Check if a trace event represents a failure (REST 4xx+ or FTP failure)
const isTraceFailure = (entry: DiagnosticsTraceEntry): boolean => {
  const type = entry.type as string | undefined;
  const data = entry.data as Record<string, unknown> | undefined;
  if (type === "rest-response" && data) {
    const status = typeof data.status === "number" ? data.status : null;
    const hasError = typeof data.error === "string" && data.error.trim().length > 0;
    return (status !== null && status >= 400) || hasError;
  }
  if (type === "ftp-operation" && data) {
    const result = typeof data.result === "string" ? data.result : null;
    const hasError = typeof data.error === "string" && data.error.trim().length > 0;
    return result === "failure" || hasError;
  }
  return false;
};

// §13.3 — Derive a problem title from a failed trace event
const traceProblemTitle = (entry: DiagnosticsTraceEntry): string => {
  const type = entry.type as string | undefined;
  const data = entry.data as Record<string, unknown> | undefined;
  if (type === "rest-response" && data) {
    const method = typeof data.method === "string" ? data.method : "REST";
    const path = typeof data.path === "string" ? data.path : "";
    return `${method} ${path} failed`.trim().slice(0, 80);
  }
  if (type === "ftp-operation" && data) {
    const op = typeof data.operation === "string" ? data.operation : "FTP";
    const path = typeof data.path === "string" ? data.path : "";
    return `${op} ${path} failed`.trim().slice(0, 80);
  }
  return "Operation failed";
};

// §12.5 — Determine origin for entry matching
const traceOrigin = (entry: DiagnosticsTraceEntry): "User" | "System" | null => {
  const origin = entry.origin as string | undefined;
  if (origin === "user") return "User";
  if (origin === "system" || origin === "automatic") return "System";
  return null;
};

const actionOrigin = (summary: ActionSummary): "User" | "System" | null => {
  if (summary.origin === "user") return "User";
  if (summary.origin === "system") return "System";
  return null;
};

export function DiagnosticsDialog({
  open,
  onOpenChange,
  healthState,
  logs,
  errorLogs,
  traceEvents,
  actionSummaries,
  onShareAll,
  onShareFiltered,
  onClearAll,
  onRetryConnection,
  defaultEvidenceTypes,
  connectionCallbacks,
  deviceInfo,
  healthCheckRunning,
  onRunHealthCheck,
  lastHealthCheckResult,
  liveHealthCheckProbes,
}: Props) {
  const { profile } = useDisplayProfile();
  const isCompact = profile === "compact";
  const isMedium = profile === "medium";

  // §5.3 — One analytic popup slot at a time
  const [activePopup, setActivePopup] = useState<ActivePopup>(null);
  // §14 — Device detail secondary view inside the overlay
  const [activeDetailView, setActiveDetailView] = useState<ActiveDetailView>(null);

  // §11.2 — Default: Problems + Actions active
  const [activeTypes, setActiveTypes] = useState<Set<EvidenceType>>(
    () => defaultEvidenceTypes ?? new Set<EvidenceType>(["Problems", "Actions"]),
  );
  const [indicatorFilter, setIndicatorFilter] = useState<IndicatorFilter>("All");
  const [searchText, setSearchText] = useState("");
  const [originFilters, setOriginFilters] = useState<Set<OriginFilter>>(() => new Set<OriginFilter>());
  // §10.1 — Summary expanded state, reset to true on each open
  const [summaryExpanded, setSummaryExpanded] = useState(true);
  // §15.1 — Pagination
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  // §8.9 / §13.4 — Auto-expand primary problem on compact
  const [autoExpandedProblemId, setAutoExpandedProblemId] = useState<string | null>(null);
  // Scroll-to ref for spotlight
  const streamRef = useRef<HTMLDivElement>(null);
  const spotlightTargetRef = useRef<string | null>(null);

  // §10.1 — Reset summary to expanded on each new open
  useEffect(() => {
    if (open) {
      setSummaryExpanded(true);
      setVisibleCount(PAGE_SIZE);
      // §8.9 — Compact auto-expansion
      if (profile === "compact" && healthState.primaryProblem) {
        setAutoExpandedProblemId(healthState.primaryProblem.id);
      } else {
        setAutoExpandedProblemId(null);
      }
    }
  }, [open]); // intentionally: reset only on open change

  // §12.5 — Origin toggle
  const handleOriginToggle = useCallback((o: OriginFilter) => {
    setOriginFilters((prev) => {
      const next = new Set(prev);
      if (next.has(o)) {
        next.delete(o);
      } else {
        next.add(o);
      }
      return next;
    });
  }, []);

  // §11.1 — Toggle evidence type (at least one must remain active)
  const handleToggleType = useCallback((type: EvidenceType) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        if (next.size === 1) return prev; // must keep at least one
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
    setVisibleCount(PAGE_SIZE);
  }, []);

  // Count refinements for Refine button label
  const refineCount = originFilters.size + (searchText.trim() !== "" ? 1 : 0);

  // §12.8 — Reset filters
  const isFiltersModified =
    !activeTypes.has("Problems") ||
    !activeTypes.has("Actions") ||
    activeTypes.has("Logs") ||
    activeTypes.has("Traces") ||
    indicatorFilter !== "All" ||
    originFilters.size > 0 ||
    searchText.trim() !== "";

  const handleResetFilters = useCallback(() => {
    setActiveTypes(new Set<EvidenceType>(["Problems", "Actions"]));
    setIndicatorFilter("All");
    setSearchText("");
    setOriginFilters(new Set<OriginFilter>());
    setVisibleCount(PAGE_SIZE);
  }, []);

  // §10.8 — Spotlight select: scroll to primary problem
  const handleSpotlightSelect = useCallback(() => {
    if (!healthState.primaryProblem) return;
    spotlightTargetRef.current = `problem-${healthState.primaryProblem.id}`;
    // Ensure problems are visible
    setActiveTypes((prev) => {
      if (prev.has("Problems")) return prev;
      const next = new Set(prev);
      next.add("Problems");
      return next;
    });
    setIndicatorFilter("All");
    // Auto-expand on compact
    if (isCompact) {
      setAutoExpandedProblemId(healthState.primaryProblem.id);
    }
  }, [healthState.primaryProblem, isCompact]);

  // Scroll to spotlight target after render
  useEffect(() => {
    const targetId = spotlightTargetRef.current;
    if (!targetId || !streamRef.current) return;
    spotlightTargetRef.current = null;
    requestAnimationFrame(() => {
      const el = streamRef.current?.querySelector(`[data-testid="${targetId}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  });

  // §13.1 — Build unified stream entries (newest first)
  type StreamEntry =
    | { kind: "problem"; data: DiagnosticsLogEntry; contributor: ContributorKey }
    | { kind: "action"; data: ActionSummary }
    | { kind: "log"; data: DiagnosticsLogEntry }
    | { kind: "trace"; data: DiagnosticsTraceEntry };

  const allStreamEntries = useMemo(() => {
    const entries: StreamEntry[] = [];
    const originActive = originFilters.size === 0 || originFilters.size === 2;
    // Track trace IDs already promoted to problems to avoid duplicates
    const problemTraceIds = new Set<string>();

    if (activeTypes.has("Problems")) {
      // §13.3 — App-level error logs as problems
      for (const entry of errorLogs) {
        if (matchesFilter(searchText, [entry.message, entry.level, entry.id])) {
          if (indicatorFilter !== "All" && indicatorFilter !== "App") continue;
          entries.push({ kind: "problem", data: entry, contributor: "App" });
        }
      }

      // §13.3 — REST/FTP failures from trace events as problems
      for (const entry of traceEvents) {
        if (!isTraceFailure(entry)) continue;
        const contributor = traceContributor(entry);
        if (!contributor || contributor === "App") continue; // App errors handled above via errorLogs
        if (indicatorFilter !== "All" && indicatorFilter !== contributor) continue;
        const title = traceProblemTitle(entry);
        if (!matchesFilter(searchText, [title, entry.id, entry.timestamp])) continue;
        // §12.5 — Origin filter
        if (!originActive) {
          const to = traceOrigin(entry);
          if (to && !originFilters.has(to)) continue;
        }
        problemTraceIds.add(entry.id);
        entries.push({
          kind: "problem",
          data: { id: entry.id, message: title, timestamp: entry.timestamp, level: "error", details: entry.data },
          contributor,
        });
      }
    }

    if (activeTypes.has("Actions")) {
      for (const s of actionSummaries) {
        if (
          matchesFilter(searchText, [
            s.actionName,
            s.correlationId,
            s.origin,
            s.outcome,
            formatDiagnosticsTimestamp(s.startTimestamp),
          ])
        ) {
          // §12.5 — Origin filter
          if (!originActive) {
            const oa = actionOrigin(s);
            if (oa && !originFilters.has(oa)) continue;
          }
          entries.push({ kind: "action", data: s });
        }
      }
    }

    if (activeTypes.has("Logs")) {
      for (const entry of logs) {
        if (matchesFilter(searchText, [entry.message, entry.level, entry.id])) {
          entries.push({ kind: "log", data: entry });
        }
      }
    }

    if (activeTypes.has("Traces")) {
      const recent = traceEvents.slice(-200).reverse();
      for (const entry of recent) {
        // Skip traces already promoted to problem entries
        if (problemTraceIds.has(entry.id)) continue;
        if (matchesFilter(searchText, [getTraceTitle(entry), entry.id, entry.timestamp])) {
          // §12.4 — indicator filter for traces
          if (indicatorFilter !== "All") {
            const tc = traceContributor(entry);
            if (tc && tc !== indicatorFilter) continue;
            if (!tc) continue; // unknown contributor filtered out
          }
          // §12.5 — Origin filter for traces
          if (!originActive) {
            const to = traceOrigin(entry);
            if (to && !originFilters.has(to)) continue;
          }
          entries.push({ kind: "trace", data: entry });
        }
      }
    }

    // §13.1 — Newest first (sort by timestamp descending)
    entries.sort((a, b) => {
      const tsA =
        a.kind === "problem" || a.kind === "log"
          ? a.data.timestamp
          : a.kind === "action"
            ? a.data.startTimestamp
            : a.data.timestamp;
      const tsB =
        b.kind === "problem" || b.kind === "log"
          ? b.data.timestamp
          : b.kind === "action"
            ? b.data.startTimestamp
            : b.data.timestamp;
      return tsB < tsA ? -1 : tsB > tsA ? 1 : 0;
    });

    return entries;
  }, [activeTypes, errorLogs, actionSummaries, logs, traceEvents, searchText, indicatorFilter, originFilters]);

  // §15.1 — Paginated entries
  const streamEntries = useMemo(() => allStreamEntries.slice(0, visibleCount), [allStreamEntries, visibleCount]);
  const hasMoreEntries = allStreamEntries.length > visibleCount;
  const hasVisibleEntries = streamEntries.length > 0;

  // §16.1 — Share filtered: pass filtered data
  const handleShareFiltered = useCallback(() => {
    const data = allStreamEntries.map((e) => e.data);
    void onShareFiltered(data);
  }, [allStreamEntries, onShareFiltered]);

  return (
    <AppSheet open={open} onOpenChange={onOpenChange}>
      <AppSheetContent
        className={cn(
          "flex min-h-0 flex-col overflow-hidden",
          isCompact
            ? "max-h-[calc(100dvh-max(3.25rem,calc(env(safe-area-inset-top)+2.75rem))-env(safe-area-inset-bottom)-4px)]"
            : null,
        )}
        data-testid="diagnostics-sheet"
      >
        {/* §9.3 — Title */}
        <AppSheetHeader
          className={cn("shrink-0", isCompact ? "space-y-1 px-3 pb-1.5 pt-2.5" : "space-y-1.5 px-4 pb-2 pt-4")}
        >
          <AppSheetTitle>Diagnostics</AppSheetTitle>
          <AppSheetDescription>Health, connectivity, and supporting evidence.</AppSheetDescription>
        </AppSheetHeader>

        {/* §14 — Device detail secondary view */}
        {activeDetailView && (
          <div className={cn("border-b border-border", isCompact ? "px-3 pb-2 pt-1.5" : "px-4 pb-3 pt-2")}>
            {activeDetailView === "device" ? (
              <DeviceDetailView info={deviceInfo ?? null} onBack={() => setActiveDetailView(null)} />
            ) : null}
            {activeDetailView === "config-drift" ? <ConfigDriftView onBack={() => setActiveDetailView(null)} /> : null}
            {activeDetailView === "health-check" ? (
              <HealthCheckDetailView
                result={lastHealthCheckResult ?? null}
                liveProbes={liveHealthCheckProbes}
                isRunning={healthCheckRunning}
                onBack={() => setActiveDetailView(null)}
              />
            ) : null}
          </div>
        )}

        {/* §10 — Collapsible health summary */}
        {!activeDetailView && (
          <HealthSummary
            healthState={healthState}
            indicatorFilter={indicatorFilter}
            onIndicatorFilterChange={setIndicatorFilter}
            onRetryConnection={onRetryConnection}
            onSpotlightSelect={handleSpotlightSelect}
            isCompact={isCompact}
            profile={profile}
            expanded={summaryExpanded}
            onExpandedChange={setSummaryExpanded}
            connectionCallbacks={connectionCallbacks}
            deviceInfo={deviceInfo}
            healthCheckRunning={healthCheckRunning}
            onRunHealthCheck={onRunHealthCheck}
            onOpenDeviceDetail={() => setActiveDetailView("device")}
            onOpenLatency={() => setActivePopup("latency")}
            onOpenHistory={() => setActivePopup("history")}
            lastHealthCheckResult={lastHealthCheckResult}
            onOpenHealthCheckDetail={() => setActiveDetailView("health-check")}
          />
        )}

        {/* §11 — Quick-focus controls */}
        <QuickFocusControls
          activeTypes={activeTypes}
          onToggle={handleToggleType}
          searchText={searchText}
          onSearchChange={setSearchText}
          originFilters={originFilters}
          onOriginToggle={handleOriginToggle}
          isCompact={isCompact}
          isMedium={isMedium}
          refineCount={refineCount}
        />

        {/* §13 — Event stream */}
        <div className={cn("flex min-h-0 flex-1 flex-col", isCompact ? "px-3 pb-2.5 pt-1.5" : "px-4 pb-4 pt-2")}>
          {/* §12.8 — Reset filters */}
          {isFiltersModified && (
            <div className="flex items-center justify-between gap-2 shrink-0 mb-2">
              <span className="text-xs text-muted-foreground">Filters active</span>
              <Button variant="ghost" size="sm" onClick={handleResetFilters} data-testid="reset-filters-button">
                Reset filters
              </Button>
            </div>
          )}

          <div ref={streamRef} className="flex-1 min-h-0 overflow-auto space-y-2">
            {/* §14.1 — Empty session */}
            {streamEntries.length === 0 && !isFiltersModified && (
              <p className="text-sm text-muted-foreground" data-testid="diagnostics-empty-message">
                No diagnostics yet. Health information will appear here after activity occurs.
              </p>
            )}

            {/* §14.3 — No results */}
            {streamEntries.length === 0 && isFiltersModified && (
              <p className="text-sm text-muted-foreground" data-testid="diagnostics-no-results-message">
                No entries match the current filters.
              </p>
            )}

            {streamEntries.map((entry) => {
              if (entry.kind === "problem") {
                const isAutoExpanded = autoExpandedProblemId === entry.data.id;
                return (
                  <DiagnosticsListItem
                    key={`problem-${entry.data.id}`}
                    testId={`problem-${entry.data.id}`}
                    mode="log"
                    severity={resolveLogSeverity(entry.data.level)}
                    title={entry.data.message}
                    timestamp={entry.data.timestamp}
                    defaultExpanded={isAutoExpanded}
                  >
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-destructive">Problem</p>
                        {/* §13.3 — Affected indicator badge */}
                        <span className="text-xs font-medium text-muted-foreground">{entry.contributor}</span>
                      </div>
                      <p className="text-sm font-medium break-words whitespace-normal">{entry.data.message}</p>
                      {entry.data.details && (
                        <pre className="text-xs whitespace-pre text-muted-foreground overflow-x-auto">
                          {JSON.stringify(entry.data.details, null, 2)}
                        </pre>
                      )}
                    </div>
                  </DiagnosticsListItem>
                );
              }

              if (entry.kind === "action") {
                return <ActionSummaryListItem key={entry.data.correlationId} summary={entry.data} />;
              }

              if (entry.kind === "log") {
                return (
                  <DiagnosticsListItem
                    key={`log-${entry.data.id}`}
                    testId={`log-${entry.data.id}`}
                    mode="log"
                    severity={resolveLogSeverity(entry.data.level)}
                    title={entry.data.message}
                    timestamp={entry.data.timestamp}
                  >
                    <div className="space-y-2">
                      <p className="text-sm font-medium break-words whitespace-normal">{entry.data.message}</p>
                      {entry.data.details && (
                        <pre className="text-xs whitespace-pre text-muted-foreground overflow-x-auto">
                          {JSON.stringify(entry.data.details, null, 2)}
                        </pre>
                      )}
                    </div>
                  </DiagnosticsListItem>
                );
              }

              // trace
              return (
                <DiagnosticsListItem
                  key={`trace-${entry.data.id}`}
                  testId={`trace-${entry.data.id}`}
                  mode="trace"
                  severity={resolveTraceSeverity(entry.data)}
                  title={getTraceTitle(entry.data)}
                  timestamp={entry.data.timestamp}
                >
                  <pre className="text-xs whitespace-pre text-muted-foreground overflow-x-auto">
                    {JSON.stringify(entry.data, null, 2)}
                  </pre>
                </DiagnosticsListItem>
              );
            })}

            {/* §15.1 — Load older entries */}
            {hasMoreEntries && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  data-testid="load-older-entries"
                >
                  Load older entries
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* §16.1 — Toolbar actions */}
        <div
          className={cn(
            "shrink-0 flex flex-wrap gap-2 border-t border-border",
            isCompact ? "px-3 py-1.5" : "px-4 py-2",
          )}
        >
          <Button variant="outline" size="sm" onClick={() => void onShareAll()} data-testid="diagnostics-share-all">
            Share all
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasVisibleEntries}
            onClick={handleShareFiltered}
            data-testid="diagnostics-share-filtered"
          >
            Share filtered
          </Button>
          {/* §15 — Heat map access from toolbar */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setActivePopup("heatmap-REST")}
            data-testid="open-heatmap-rest"
            title="REST activity heat map"
          >
            <BarChart2 className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
            REST
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setActivePopup("heatmap-FTP")}
            data-testid="open-heatmap-ftp"
            title="FTP activity heat map"
          >
            <BarChart2 className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
            FTP
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setActivePopup("heatmap-CONFIG")}
            data-testid="open-heatmap-config"
            title="Config activity heat map"
          >
            <BarChart2 className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
            Config
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setActiveDetailView("config-drift")}
            data-testid="open-config-drift"
          >
            Config drift
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" data-testid="diagnostics-clear-all-trigger">
                Clear all
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent surface="confirmation">
              <AlertDialogHeader>
                <AlertDialogTitle>Clear all diagnostics?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes health evidence, problems, actions, logs, and traces for the current session.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={onClearAll}
                  className="bg-destructive text-destructive-foreground"
                  data-testid="diagnostics-clear-all-confirm"
                >
                  Clear
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </AppSheetContent>

      {/* §5.3 — Nested analytic popups (one at a time, above the overlay) */}
      <LatencyAnalysisPopup open={activePopup === "latency"} onClose={() => setActivePopup(null)} />
      <HealthHistoryPopup open={activePopup === "history"} onClose={() => setActivePopup(null)} />
      {(activePopup === "heatmap-REST" || activePopup === "heatmap-FTP" || activePopup === "heatmap-CONFIG") && (
        <HeatMapPopup
          open
          onClose={() => setActivePopup(null)}
          variant={activePopup.replace("heatmap-", "") as HeatMapVariant}
          traceEvents={traceEvents}
        />
      )}
    </AppSheet>
  );
}
