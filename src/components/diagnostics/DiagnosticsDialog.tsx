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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
import {
  resolveActionSeverity,
  resolveLogSeverity,
  resolveTraceSeverity,
  type DiagnosticsSeverity,
} from "@/lib/diagnostics/diagnosticsSeverity";
import { formatDiagnosticsTimestamp } from "@/lib/diagnostics/timeFormat";
import { getTraceTitle } from "@/lib/tracing/traceFormatter";
import { cn } from "@/lib/utils";
import {
  Activity,
  BarChart2,
  CircleHelp,
  ChevronDown,
  ChevronUp,
  Clock,
  FilterX,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Search,
  Share2,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// §11 — Evidence type filters
export type EvidenceType = "Problems" | "Actions" | "Logs" | "Traces";

// §12.4 — Health indicator filter
export type IndicatorFilter = ContributorKey | "All";

// §12.5 — Origin filters
export type OriginFilter = "User" | "System";

type SeverityFilter = "All" | "Errors" | "Warnings" | "Info";

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

type StreamEntry =
  | {
      id: string;
      kind: "problem";
      timestamp: string;
      contributor: ContributorKey;
      origin: OriginFilter | null;
      severity: DiagnosticsSeverity;
      data: DiagnosticsLogEntry;
    }
  | {
      id: string;
      kind: "action";
      timestamp: string;
      contributor: ContributorKey | null;
      origin: OriginFilter | null;
      severity: DiagnosticsSeverity;
      data: ActionSummary;
    }
  | {
      id: string;
      kind: "log";
      timestamp: string;
      contributor: ContributorKey | null;
      origin: OriginFilter | null;
      severity: DiagnosticsSeverity;
      data: DiagnosticsLogEntry;
    }
  | {
      id: string;
      kind: "trace";
      timestamp: string;
      contributor: ContributorKey | null;
      origin: OriginFilter | null;
      severity: DiagnosticsSeverity;
      data: DiagnosticsTraceEntry;
    };

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

const SEVERITY_FILTERS: SeverityFilter[] = ["All", "Errors", "Warnings", "Info"];

const matchesSeverityFilter = (filter: SeverityFilter, severity: DiagnosticsSeverity) => {
  if (filter === "All") return true;
  if (filter === "Errors") return severity === "error";
  if (filter === "Warnings") return severity === "warn";
  return severity === "info" || severity === "debug";
};

const describeSeverityFilter = (filter: SeverityFilter) => {
  if (filter === "Errors") return "Errors only";
  if (filter === "Warnings") return "Warnings only";
  if (filter === "Info") return "Info and debug";
  return "Any severity";
};

const formatStreamTimestamp = (timestamp: string | null) => {
  if (!timestamp) return "No recent activity";
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return formatDiagnosticsTimestamp(timestamp);
  return parsed.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
};

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
  const trimmedPhrase = phrase.trim();
  const isRedundantPhrase = trimmedPhrase.toLowerCase() === health.state.toLowerCase();
  const maxPhrase = profile === "compact" ? 30 : profile === "medium" ? 50 : undefined;
  const displayPhrase = maxPhrase ? phrase.slice(0, maxPhrase) : phrase;
  // §10.6 — Expanded profile adds session totals
  const sessionTotal =
    profile === "expanded" && health.totalOperations > 0 ? ` · ${health.totalOperations} session total` : "";
  const secondaryDetail = isRedundantPhrase ? sessionTotal.replace(/^ · /, "") : `${displayPhrase}${sessionTotal}`;
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
      {secondaryDetail ? <span className="text-muted-foreground truncate">{secondaryDetail}</span> : null}
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
    <p className="text-xs font-semibold text-destructive uppercase tracking-wide mb-0.5">Needs attention</p>
    <p className="text-sm font-medium truncate">{problem.title.slice(0, 60)}</p>
    {problem.causeHint && <p className="text-xs text-muted-foreground truncate">{problem.causeHint.slice(0, 40)}</p>}
    <p className="text-xs text-muted-foreground mt-0.5">{problem.contributor}</p>
  </button>
);

const SectionHelp = ({ label, children, testId }: { label: string; children: string; testId?: string }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label={`${label} help`}
        data-testid={testId}
      >
        <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </TooltipTrigger>
    <TooltipContent className="max-w-xs text-xs leading-relaxed">{children}</TooltipContent>
  </Tooltip>
);

// § StatusSummaryCard — Layer 1: single dominant card on first open
const StatusSummaryCard = ({
  healthState,
  onShowDetails,
  onRunHealthCheck,
  healthCheckRunning,
  connectionCallbacks,
  isCompact,
  lastHealthCheckResult,
  onOpenHealthCheckDetail,
}: {
  healthState: OverallHealthState;
  onShowDetails: () => void;
  onRunHealthCheck?: () => void;
  healthCheckRunning?: boolean;
  connectionCallbacks?: ConnectionActionsCallbacks;
  isCompact: boolean;
  lastHealthCheckResult?: import("@/lib/diagnostics/healthCheckEngine").HealthCheckRunResult | null;
  onOpenHealthCheckDetail: () => void;
}) => {
  const { state, connectivity, host, primaryProblem } = healthState;
  const connectedLabel =
    (healthState as OverallHealthState & { connectedDeviceLabel?: string | null }).connectedDeviceLabel ?? null;

  const isOffline = connectivity === "Offline" || connectivity === "Not yet connected";
  const isUnhealthy = !isOffline && (state === "Unhealthy" || state === "Degraded");
  const recoveryFirst = isRecoveryFirstState(connectivity);

  const title = isOffline
    ? "Device not reachable"
    : isUnhealthy
      ? "Needs attention"
      : state === "Idle"
        ? "Ready"
        : "Healthy";

  const titleColorClass = isOffline ? "text-destructive" : isUnhealthy ? "text-amber-500" : "text-success";

  const glyph = HEALTH_GLYPHS[isOffline ? "Unavailable" : state];
  const showSplitHealthCheck = !isOffline && Boolean(lastHealthCheckResult);

  return (
    <div
      className={cn("bg-card border border-border rounded-xl space-y-3", isCompact ? "p-3" : "p-4")}
      data-testid="status-summary-card"
    >
      {/* Title row */}
      <div className="flex items-center gap-2">
        <span
          className={cn("font-mono leading-none shrink-0", isCompact ? "text-xl" : "text-2xl", titleColorClass)}
          aria-hidden="true"
        >
          {glyph}
        </span>
        <span className={cn("font-semibold", isCompact ? "text-base" : "text-lg", titleColorClass)}>{title}</span>
      </div>

      {/* Device / issue context */}
      <div className="space-y-1">
        {isOffline && (
          <>
            <p className="text-sm font-mono text-muted-foreground">{host}</p>
            <p className="text-sm text-muted-foreground">Cannot reach your device.</p>
          </>
        )}
        {isUnhealthy && primaryProblem && (
          <>
            <p className="text-sm font-medium truncate">{primaryProblem.title.slice(0, 80)}</p>
            <p className="text-xs text-muted-foreground">{primaryProblem.contributor}</p>
            {primaryProblem.causeHint && (
              <p className="text-xs text-muted-foreground truncate">{primaryProblem.causeHint.slice(0, 60)}</p>
            )}
          </>
        )}
        {isUnhealthy && !primaryProblem && (
          <p className="text-sm text-muted-foreground">Some systems need attention.</p>
        )}
        {!isOffline && !isUnhealthy && (
          <p className="text-sm text-muted-foreground">
            {connectedLabel ? `${connectedLabel} · ` : ""}
            {state === "Idle" ? "No activity yet." : "All systems working."}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="space-y-2">
        {/* Connection actions — always shown when callbacks provided (includes switch device) */}
        {connectionCallbacks && (
          <ConnectionActionsRegion
            connectivity={connectivity}
            currentHost={host}
            callbacks={connectionCallbacks}
            defaultExpanded={recoveryFirst}
          />
        )}

        {/* Health check button — shown when not offline */}
        {onRunHealthCheck && !isOffline && (
          <div className={showSplitHealthCheck ? "grid grid-cols-2 gap-1.5" : ""}>
            <Button
              size="sm"
              variant="outline"
              onClick={onRunHealthCheck}
              disabled={healthCheckRunning}
              className={cn("w-full", showSplitHealthCheck && "min-w-0 px-2")}
              data-testid="run-health-check-button"
            >
              {healthCheckRunning ? "Running health check…" : isCompact ? "Run check" : "Run health check"}
            </Button>
            {lastHealthCheckResult && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onOpenHealthCheckDetail}
                className={cn("w-full", showSplitHealthCheck && "min-w-0 px-2")}
                data-testid="open-health-check-detail"
              >
                {isCompact ? "Last check" : "Last health check"}
              </Button>
            )}
          </div>
        )}

        {/* View details link */}
        <div className="pt-0.5">
          <button
            type="button"
            onClick={onShowDetails}
            className="text-xs text-muted-foreground hover:text-foreground underline transition-colors"
            data-testid="show-details-button"
          >
            View activity and details
          </button>
        </div>
      </div>
    </div>
  );
};

// § EvidencePreviewCard — Layer 3: max 3 entries, no filters, human-readable guide to recent activity
const EvidencePreviewCard = ({
  entries,
  onViewAll,
  isCompact,
}: {
  entries: StreamEntry[];
  onViewAll: () => void;
  isCompact: boolean;
}) => {
  if (entries.length === 0) return null;

  return (
    <div
      className={cn("bg-card border border-border rounded-xl space-y-2", isCompact ? "p-3" : "p-4")}
      data-testid="evidence-preview-card"
    >
      <p className="text-xs font-semibold text-primary uppercase tracking-wider">Recent activity</p>
      <div className="space-y-1.5">
        {entries.map((entry) => {
          if (entry.kind === "action") {
            return <ActionSummaryListItem key={`prev-${entry.data.correlationId}`} summary={entry.data} />;
          }
          const title =
            entry.kind === "problem" || entry.kind === "log" ? entry.data.message : getTraceTitle(entry.data);
          return (
            <DiagnosticsListItem
              key={`prev-${entry.id}`}
              testId={`preview-${entry.id}`}
              mode="log"
              severity={entry.severity}
              title={title}
              timestamp={entry.timestamp}
            />
          );
        })}
      </div>
      <button
        type="button"
        onClick={onViewAll}
        className="text-xs text-muted-foreground hover:text-foreground underline transition-colors"
        data-testid="view-all-activity"
      >
        View all activity →
      </button>
    </div>
  );
};

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
  techDetailsExpanded,
  onTechDetailsExpandedChange,
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
  techDetailsExpanded: boolean;
  onTechDetailsExpandedChange: (v: boolean) => void;
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
  const showSplitHealthCheckActions = profile !== "expanded" && Boolean(lastHealthCheckResult);
  const healthCheckPrimaryLabel =
    profile === "compact" && !healthCheckRunning
      ? "Run check"
      : healthCheckRunning
        ? "Running health check…"
        : "Run health check";
  const healthCheckSecondaryLabel = profile === "compact" ? "Last check" : "Last health check";

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
        <div className="space-y-1.5">
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

          {/* §10.8 — Primary problem spotlight */}
          {primaryProblem && <PrimaryProblemSpotlight problem={primaryProblem} onSelect={onSpotlightSelect} />}

          {/* §T — Technical details disclosure */}
          <button
            type="button"
            onClick={() => onTechDetailsExpandedChange(!techDetailsExpanded)}
            className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            data-testid="technical-details-toggle"
            aria-expanded={techDetailsExpanded}
          >
            <span className="font-medium">Technical details</span>
            {techDetailsExpanded ? (
              <ChevronUp className="h-3 w-3 shrink-0" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
            )}
          </button>

          {techDetailsExpanded && (
            <div className="space-y-1.5">
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
            </div>
          )}

          {/* §11.2 — Run health check */}
          {onRunHealthCheck && (
            <div className={cn(showSplitHealthCheckActions ? "grid grid-cols-2 gap-1.5" : "space-y-1.5")}>
              <Button
                size="sm"
                variant="outline"
                onClick={onRunHealthCheck}
                disabled={healthCheckRunning}
                className={cn("w-full", showSplitHealthCheckActions && "min-w-0 px-2")}
                data-testid="run-health-check-button"
              >
                {healthCheckPrimaryLabel}
              </Button>
              {lastHealthCheckResult && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onOpenHealthCheckDetail}
                  className={cn("w-full", showSplitHealthCheckActions && "min-w-0 px-2")}
                  data-testid="open-health-check-detail"
                >
                  {healthCheckSecondaryLabel}
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
  indicatorFilter,
  onIndicatorFilterChange,
  severityFilter,
  onSeverityFilterChange,
  searchText,
  onSearchChange,
  originFilters,
  onOriginToggle,
  isCompact,
  isMedium,
  refineCount,
  entryCount,
}: {
  activeTypes: Set<EvidenceType>;
  onToggle: (t: EvidenceType) => void;
  indicatorFilter: IndicatorFilter;
  onIndicatorFilterChange: (filter: IndicatorFilter) => void;
  severityFilter: SeverityFilter;
  onSeverityFilterChange: (filter: SeverityFilter) => void;
  searchText: string;
  onSearchChange: (v: string) => void;
  originFilters: Set<OriginFilter>;
  onOriginToggle: (o: OriginFilter) => void;
  isCompact: boolean;
  isMedium: boolean;
  refineCount: number;
  entryCount: number;
}) => {
  const [refineOpen, setRefineOpen] = useState(false);
  const types: EvidenceType[] = ["Problems", "Actions", "Logs", "Traces"];
  const origins: OriginFilter[] = ["User", "System"];
  const contributors: IndicatorFilter[] = ["All", "App", "REST", "FTP"];

  // §11.3 — Compact: search + origin behind Refine; Medium: origin behind Refine; Expanded: all visible
  const showRefineButton = isCompact || isMedium;
  const showSearchInline = !isCompact;
  const showAdvancedInline = !isCompact && !isMedium;

  const renderFilterButton = <T extends string>(
    value: T,
    label: string,
    active: boolean,
    onClick: () => void,
    testId: string,
  ) => (
    <button
      key={value}
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );

  const contributorControls = (
    <div className="flex flex-wrap items-center gap-1.5">
      {contributors.map((filter) =>
        renderFilterButton(
          filter,
          filter,
          indicatorFilter === filter,
          () => onIndicatorFilterChange(filter),
          `indicator-toggle-${filter.toLowerCase()}`,
        ),
      )}
    </div>
  );

  const originControls = (
    <div className="flex flex-wrap items-center gap-1.5">
      {origins.map((o) =>
        renderFilterButton(o, o, originFilters.has(o), () => onOriginToggle(o), `origin-toggle-${o.toLowerCase()}`),
      )}
    </div>
  );

  const severityControls = (
    <div className="flex flex-wrap items-center gap-1.5">
      {SEVERITY_FILTERS.map((filter) =>
        renderFilterButton(
          filter,
          filter,
          severityFilter === filter,
          () => onSeverityFilterChange(filter),
          `severity-toggle-${filter.toLowerCase()}`,
        ),
      )}
    </div>
  );

  return (
    <div
      className={cn("shrink-0 border-b border-border bg-muted/20", isCompact ? "px-3 pb-2 pt-1.5" : "px-4 pb-2.5 pt-2")}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Filters</p>
          <SectionHelp label="Filters" testId="filters-help">
            Choose evidence types and narrow the visible activity by contributor, origin, severity, or text.
          </SectionHelp>
          <Badge variant="outline" className="border-border bg-background/80 text-muted-foreground">
            {entryCount} match{entryCount === 1 ? "" : "es"}
          </Badge>
        </div>
        {showRefineButton && (
          <button
            type="button"
            onClick={() => setRefineOpen((v) => !v)}
            aria-pressed={refineOpen}
            data-testid="refine-button"
            className={cn(
              "shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              refineOpen
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary/40",
            )}
          >
            <SlidersHorizontal className="mr-1 inline-block h-3 w-3" aria-hidden="true" />
            More filters
            {refineCount > 0 ? (
              <span className="ml-1 inline-flex min-w-4 items-center justify-center rounded-full bg-primary/15 px-1 text-[10px] leading-4 text-primary">
                {refineCount}
              </span>
            ) : null}
          </button>
        )}
      </div>

      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        {types.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onToggle(t)}
            aria-pressed={activeTypes.has(t)}
            data-testid={`evidence-toggle-${t.toLowerCase()}`}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              activeTypes.has(t)
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary/40",
            )}
          >
            {t}
          </button>
        ))}
      </div>

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

      {showAdvancedInline ? (
        <div className="space-y-2 pt-2">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Contributor</p>
            {contributorControls}
          </div>
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Origin</p>
            {originControls}
          </div>
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Severity</p>
            {severityControls}
          </div>
        </div>
      ) : null}

      {showRefineButton && refineOpen && (
        <div className="space-y-2 pt-2" data-testid="refine-panel">
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
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Contributor</p>
            {contributorControls}
          </div>
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Origin</p>
            {originControls}
          </div>
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Severity</p>
            {severityControls}
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

  // § Progressive disclosure: summary-only on first open; showDetails=true reveals all layers
  const [showDetails, setShowDetails] = useState(false);
  // § Split-pane focus: which pane is maximized in expanded profile (null = equal split)
  const [paneFocus, setPaneFocus] = useState<'both' | 'left' | 'right'>('both');
  // §5.3 — One analytic popup slot at a time
  const [activePopup, setActivePopup] = useState<ActivePopup>(null);
  // §14 — Device detail secondary view inside the overlay
  const [activeDetailView, setActiveDetailView] = useState<ActiveDetailView>(null);

  // §11.2 — Default: Problems + Actions active
  const [activeTypes, setActiveTypes] = useState<Set<EvidenceType>>(
    () => defaultEvidenceTypes ?? new Set<EvidenceType>(["Problems", "Actions"]),
  );
  const [indicatorFilter, setIndicatorFilter] = useState<IndicatorFilter>("All");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("All");
  const [searchText, setSearchText] = useState("");
  const [originFilters, setOriginFilters] = useState<Set<OriginFilter>>(() => new Set<OriginFilter>());
  // §10.1 — Summary expanded state, reset to true on each open
  const [summaryExpanded, setSummaryExpanded] = useState(true);
  // §T — Technical details expanded state: closed on compact, open on medium/expanded
  const [techDetailsExpanded, setTechDetailsExpanded] = useState(!isCompact);
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
      setShowDetails(false);
      setPaneFocus('both');
      setSummaryExpanded(true);
      setTechDetailsExpanded(!isCompact);
      setVisibleCount(PAGE_SIZE);
      // §8.9 — Compact auto-expansion
      if (profile === "compact" && healthState.primaryProblem) {
        setAutoExpandedProblemId(healthState.primaryProblem.id);
      } else {
        setAutoExpandedProblemId(null);
      }
    }
  }, [open]); // intentionally: reset only on open change

  const rawFocusActive =
    searchText.trim() !== "" ||
    severityFilter !== "All" ||
    activeTypes.has("Logs") ||
    activeTypes.has("Traces") ||
    originFilters.size > 0 ||
    indicatorFilter !== "All";

  useEffect(() => {
    if (!open) return;
    if (profile === "expanded") return;
    if (!summaryExpanded) return;
    if (!rawFocusActive) return;
    setSummaryExpanded(false);
  }, [open, profile, rawFocusActive, summaryExpanded]);

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

  const entryFilterCount = refineCount + (indicatorFilter !== "All" ? 1 : 0) + (severityFilter !== "All" ? 1 : 0);

  // §12.8 — Reset filters
  const isFiltersModified =
    !activeTypes.has("Problems") ||
    !activeTypes.has("Actions") ||
    activeTypes.has("Logs") ||
    activeTypes.has("Traces") ||
    indicatorFilter !== "All" ||
    severityFilter !== "All" ||
    originFilters.size > 0 ||
    searchText.trim() !== "";

  const handleResetFilters = useCallback(() => {
    setActiveTypes(new Set<EvidenceType>(["Problems", "Actions"]));
    setIndicatorFilter("All");
    setSeverityFilter("All");
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

  const allStreamEntries = useMemo(() => {
    const entries: StreamEntry[] = [];
    const originActive = originFilters.size === 0 || originFilters.size === 2;
    // Track trace IDs already promoted to problems to avoid duplicates
    const problemTraceIds = new Set<string>();

    if (activeTypes.has("Problems")) {
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
        const severity = resolveLogSeverity("error");
        if (!matchesSeverityFilter(severityFilter, severity)) continue;
        problemTraceIds.add(entry.id);
        entries.push({
          id: entry.id,
          kind: "problem",
          timestamp: entry.timestamp,
          origin: traceOrigin(entry),
          severity,
          data: { id: entry.id, message: title, timestamp: entry.timestamp, level: "error", details: entry.data },
          contributor,
        });
      }

      for (const entry of errorLogs) {
        const severity = resolveLogSeverity(entry.level);
        if (!matchesSeverityFilter(severityFilter, severity)) continue;
        if (matchesFilter(searchText, [entry.message, entry.level, entry.id])) {
          if (indicatorFilter !== "All" && indicatorFilter !== "App") continue;
          entries.push({
            id: entry.id,
            kind: "problem",
            timestamp: entry.timestamp,
            contributor: "App",
            origin: null,
            severity,
            data: entry,
          });
        }
      }
    }

    if (activeTypes.has("Actions")) {
      for (const s of actionSummaries) {
        const severity = resolveActionSeverity(s.outcome);
        if (!matchesSeverityFilter(severityFilter, severity)) continue;
        if (indicatorFilter !== "All") {
          const matchedContributor = s.effects?.some((effect) => {
            if (indicatorFilter === "REST") return effect.type === "REST";
            if (indicatorFilter === "FTP") return effect.type === "FTP";
            if (indicatorFilter === "App") return effect.type === "ERROR";
            return false;
          });
          if (!matchedContributor) continue;
        }
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
          entries.push({
            id: s.correlationId,
            kind: "action",
            timestamp: s.startTimestamp,
            contributor: null,
            origin: actionOrigin(s),
            severity,
            data: s,
          });
        }
      }
    }

    if (activeTypes.has("Logs")) {
      for (const entry of logs) {
        const severity = resolveLogSeverity(entry.level);
        if (!matchesSeverityFilter(severityFilter, severity)) continue;
        if (matchesFilter(searchText, [entry.message, entry.level, entry.id])) {
          entries.push({
            id: entry.id,
            kind: "log",
            timestamp: entry.timestamp,
            contributor: null,
            origin: null,
            severity,
            data: entry,
          });
        }
      }
    }

    if (activeTypes.has("Traces")) {
      const recent = traceEvents.slice(-200).reverse();
      for (const entry of recent) {
        // Skip traces already promoted to problem entries
        if (problemTraceIds.has(entry.id)) continue;
        const severity = resolveTraceSeverity(entry);
        if (!matchesSeverityFilter(severityFilter, severity)) continue;
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
          entries.push({
            id: entry.id,
            kind: "trace",
            timestamp: entry.timestamp,
            contributor: traceContributor(entry),
            origin: traceOrigin(entry),
            severity,
            data: entry,
          });
        }
      }
    }

    // §13.1 — Newest first (sort by timestamp descending)
    entries.sort((a, b) => {
      const tsA = a.timestamp;
      const tsB = b.timestamp;
      return tsB < tsA ? -1 : tsB > tsA ? 1 : 0;
    });

    return entries;
  }, [
    activeTypes,
    actionSummaries,
    errorLogs,
    indicatorFilter,
    logs,
    originFilters,
    searchText,
    severityFilter,
    traceEvents,
  ]);

  // §15.1 — Paginated entries
  const streamEntries = useMemo(() => allStreamEntries.slice(0, visibleCount), [allStreamEntries, visibleCount]);
  const hasMoreEntries = allStreamEntries.length > visibleCount;
  const hasVisibleEntries = streamEntries.length > 0;
  const newestEntryTimestamp = streamEntries[0]?.timestamp ?? allStreamEntries[0]?.timestamp ?? null;
  const visibleProblemCount = streamEntries.filter((entry) => entry.kind === "problem").length;
  // § Evidence preview — top 3 entries for the summary view (no filter changes needed)
  const previewEntries = useMemo(() => allStreamEntries.slice(0, 3), [allStreamEntries]);
  const activeFilterPills = [
    indicatorFilter !== "All" ? `Contributor: ${indicatorFilter}` : null,
    severityFilter !== "All" ? describeSeverityFilter(severityFilter) : null,
    originFilters.size > 0 ? `Origin: ${Array.from(originFilters).join(" + ")}` : null,
    searchText.trim() !== "" ? `Search: “${searchText.trim()}”` : null,
  ].filter(Boolean) as string[];
  const useInsightsRail = showDetails && profile === "expanded";

  // §16.1 — Share filtered: pass filtered data
  const handleShareFiltered = useCallback(() => {
    const data = allStreamEntries.map((e) => e.data);
    void onShareFiltered(data);
  }, [allStreamEntries, onShareFiltered]);

  return (
    <TooltipProvider delayDuration={150}>
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
          <AppSheetHeader
            className={cn("shrink-0", isCompact ? "space-y-1.5 px-3 pb-2 pt-2.5" : "space-y-1.5 px-4 pb-2.5 pt-3.5")}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <AppSheetTitle>Diagnostics</AppSheetTitle>
                <AppSheetDescription
                  className={cn("max-w-full truncate whitespace-nowrap pr-8", !showDetails && "hidden")}
                  data-testid="diagnostics-subtitle"
                >
                  Health, status, and recent evidence.
                </AppSheetDescription>
              </div>
              {showDetails && (
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  <Badge variant="outline" className="gap-1 border-primary/30 bg-primary/5 text-primary">
                    <Sparkles className="h-3 w-3" aria-hidden="true" />
                    {allStreamEntries.length} entries
                  </Badge>
                  <Badge variant="outline" className="gap-1 border-border bg-background/80 text-foreground">
                    <TriangleAlert className="h-3 w-3" aria-hidden="true" />
                    {visibleProblemCount} problems in view
                  </Badge>
                  {entryFilterCount > 0 ? (
                    <Badge variant="outline" className="gap-1 border-border bg-background/80 text-muted-foreground">
                      <FilterX className="h-3 w-3" aria-hidden="true" />
                      {entryFilterCount} active filters
                    </Badge>
                  ) : null}
                </div>
              )}
            </div>
          </AppSheetHeader>

          {/* Three-way conditional: detail view | summary | full details */}
          {activeDetailView ? (
            /* Active detail view replaces main content */
            <div className={cn("flex-1 overflow-auto", isCompact ? "px-3 pb-4 pt-2" : "px-4 pb-4 pt-3")}>
              {activeDetailView === "device" ? (
                <DeviceDetailView info={deviceInfo ?? null} onBack={() => setActiveDetailView(null)} />
              ) : null}
              {activeDetailView === "config-drift" ? (
                <ConfigDriftView onBack={() => setActiveDetailView(null)} />
              ) : null}
              {activeDetailView === "health-check" ? (
                <HealthCheckDetailView
                  result={lastHealthCheckResult ?? null}
                  liveProbes={liveHealthCheckProbes}
                  isRunning={healthCheckRunning}
                  onBack={() => setActiveDetailView(null)}
                />
              ) : null}
            </div>
          ) : !showDetails ? (
            /* Summary view — Layer 1 (status) + Layer 3 preview (max 3 entries) */
            <div className="flex-1 overflow-auto">
              <div className={cn("space-y-3", isCompact ? "px-3 py-3" : "px-4 py-4")}>
                <StatusSummaryCard
                  healthState={healthState}
                  onShowDetails={() => setShowDetails(true)}
                  onRunHealthCheck={onRunHealthCheck}
                  healthCheckRunning={healthCheckRunning}
                  connectionCallbacks={connectionCallbacks}
                  isCompact={isCompact}
                  lastHealthCheckResult={lastHealthCheckResult}
                  onOpenHealthCheckDetail={() => setActiveDetailView("health-check")}
                />
                {healthState.primaryProblem && (
                  <PrimaryProblemSpotlight
                    problem={healthState.primaryProblem}
                    onSelect={() => {
                      setShowDetails(true);
                      handleSpotlightSelect();
                    }}
                  />
                )}
                <EvidencePreviewCard
                  entries={previewEntries}
                  onViewAll={() => setShowDetails(true)}
                  isCompact={isCompact}
                />
              </div>
            </div>
          ) : (
            /* Full details view — Layers 4-5: Technical + Tools */
            <div className={cn("flex min-h-0 flex-1", useInsightsRail ? "flex-row" : "flex-col")}>
              <div
                className={cn(
                  useInsightsRail
                    ? cn(
                        "flex min-h-0 flex-col border-r border-border",
                        paneFocus === 'left' ? "flex-1 min-w-0" :
                        paneFocus === 'right' ? "w-10 shrink-0 overflow-hidden" :
                        "w-[19rem] shrink-0",
                      )
                    : "",
                )}
              >
                {useInsightsRail && paneFocus === 'right' ? (
                  /* Minimised left strip — restore button */
                  <div className="flex h-full flex-col items-center pt-3">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => setPaneFocus('both')}
                          className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                          data-testid="pane-expand-left"
                        >
                          <PanelRightOpen className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right">Show health summary</TooltipContent>
                    </Tooltip>
                  </div>
                ) : (
                  <>
                    {useInsightsRail && (
                      <div className="flex items-center justify-end border-b border-border/40 px-2 py-0.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => setPaneFocus(paneFocus === 'left' ? 'both' : 'left')}
                              className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                              data-testid="pane-focus-health"
                            >
                              {paneFocus === 'left' ? (
                                <PanelRightOpen className="h-3.5 w-3.5" aria-hidden="true" />
                              ) : (
                                <PanelRightClose className="h-3.5 w-3.5" aria-hidden="true" />
                              )}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="right">
                            {paneFocus === 'left' ? 'Restore split view' : 'Maximise health summary'}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    )}
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
                  techDetailsExpanded={techDetailsExpanded}
                  onTechDetailsExpandedChange={setTechDetailsExpanded}
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

                <QuickFocusControls
                  activeTypes={activeTypes}
                  onToggle={handleToggleType}
                  indicatorFilter={indicatorFilter}
                  onIndicatorFilterChange={setIndicatorFilter}
                  severityFilter={severityFilter}
                  onSeverityFilterChange={setSeverityFilter}
                  searchText={searchText}
                  onSearchChange={setSearchText}
                  originFilters={originFilters}
                  onOriginToggle={handleOriginToggle}
                  isCompact={isCompact}
                  isMedium={isMedium}
                  refineCount={refineCount}
                  entryCount={allStreamEntries.length}
                />
                  </>
                )}
              </div>

              <div
                className={cn(
                  "flex min-h-0 min-w-0 flex-col",
                  useInsightsRail && paneFocus === 'left'
                    ? "w-10 shrink-0 overflow-hidden px-0"
                    : cn("flex-1", isCompact ? "px-3 pb-2.5 pt-1.5" : "px-4 pb-4 pt-2"),
                )}
              >
                {useInsightsRail && paneFocus === 'left' ? (
                  /* Minimised right strip — restore button */
                  <div className="flex h-full flex-col items-center pt-3">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => setPaneFocus('both')}
                          className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                          data-testid="pane-expand-right"
                        >
                          <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="left">Show activity</TooltipContent>
                    </Tooltip>
                  </div>
                ) : (
                  <>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-border/70 pb-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Activity
                      </p>
                      <SectionHelp label="Activity" testId="activity-help">
                        Recent session evidence in reverse chronological order. Filters decide which entries stay in
                        view.
                      </SectionHelp>
                      <Badge variant="outline" className="border-border bg-background/80 text-muted-foreground">
                        Showing {streamEntries.length} of {allStreamEntries.length}
                      </Badge>
                      <Badge variant="outline" className="border-border bg-background/80 text-muted-foreground">
                        Latest {formatStreamTimestamp(newestEntryTimestamp)}
                      </Badge>
                    </div>
                    {activeFilterPills.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {activeFilterPills.map((pill) => (
                          <Badge
                            key={pill}
                            variant="outline"
                            className="border-border bg-background/80 text-muted-foreground"
                          >
                            {pill}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {isFiltersModified ? (
                      <Button variant="ghost" size="sm" onClick={handleResetFilters} data-testid="reset-filters-button">
                        Reset filters
                      </Button>
                    ) : null}
                    {useInsightsRail && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => setPaneFocus(paneFocus === 'right' ? 'both' : 'right')}
                            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                            data-testid="pane-focus-activity"
                          >
                            {paneFocus === 'right' ? (
                              <PanelLeftOpen className="h-3.5 w-3.5" aria-hidden="true" />
                            ) : (
                              <PanelLeftClose className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="left">
                          {paneFocus === 'right' ? 'Restore split view' : 'Maximise activity'}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </div>

                <div ref={streamRef} className="flex-1 min-h-0 overflow-auto space-y-1.5 pr-1">
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
                <div
                  className={cn(
                    "sticky bottom-0 z-10 mt-2 border-t border-border/70 bg-background/95 pt-2 backdrop-blur supports-[backdrop-filter]:bg-background/85",
                    isCompact
                      ? "pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
                      : "pb-[calc(0.25rem+env(safe-area-inset-bottom))]",
                  )}
                  data-testid="diagnostics-action-shelf"
                >
                  <div
                    className={cn(
                      "flex items-center gap-1.5",
                      isCompact ? "grid grid-cols-3" : "flex-wrap justify-end",
                    )}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void onShareAll()}
                      data-testid="diagnostics-share-all"
                      aria-label="Share all"
                      className="h-8 gap-1.5 px-2"
                    >
                      <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                      {isCompact ? 'All' : 'Share all'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!hasVisibleEntries}
                      onClick={handleShareFiltered}
                      data-testid="diagnostics-share-filtered"
                      aria-label="Share filtered"
                      className="h-8 gap-1.5 px-2"
                    >
                      <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                      {isCompact ? 'Filtered' : 'Share filtered'}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 px-2"
                          data-testid="diagnostics-tools-menu"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                          Tools
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuItem
                          onSelect={() => setActivePopup("heatmap-REST")}
                          data-testid="open-heatmap-rest"
                        >
                          <BarChart2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                          REST heat map
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setActivePopup("heatmap-FTP")} data-testid="open-heatmap-ftp">
                          <BarChart2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                          FTP heat map
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => setActivePopup("heatmap-CONFIG")}
                          data-testid="open-heatmap-config"
                        >
                          <BarChart2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                          Config heat map
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => setActiveDetailView("config-drift")}
                          data-testid="open-config-drift"
                        >
                          <Activity className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                          Config drift
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <button
                              type="button"
                              className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm text-destructive outline-none transition-colors hover:bg-accent"
                              data-testid="diagnostics-clear-all-trigger"
                            >
                              <TriangleAlert className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                              Clear all diagnostics
                            </button>
                          </AlertDialogTrigger>
                          <AlertDialogContent surface="confirmation">
                            <AlertDialogHeader>
                              <AlertDialogTitle>Clear all diagnostics?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This removes health evidence, problems, actions, logs, and traces for the current
                                session.
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
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                  </>
                )}
              </div>
            </div>
          )}
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
    </TooltipProvider>
  );
}
