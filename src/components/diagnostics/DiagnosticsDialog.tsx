/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BarChart2,
  CircleHelp,
  Clock,
  MoreHorizontal,
  Search,
  Share2,
  SlidersHorizontal,
  TriangleAlert,
  X,
} from "lucide-react";

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
import {
  ConnectionActionsRegion,
  isRecoveryFirstState,
  type ConnectionActionsCallbacks,
} from "@/components/diagnostics/ConnectionActionsRegion";
import { ConfigDriftView } from "@/components/diagnostics/ConfigDriftView";
import { DeviceDetailView, type DeviceDetailInfo } from "@/components/diagnostics/DeviceDetailView";
import { DiagnosticsListItem } from "@/components/diagnostics/DiagnosticsListItem";
import { EvidenceFullView } from "@/components/diagnostics/EvidenceFullView";
import { HealthCheckDetailView } from "@/components/diagnostics/HealthCheckDetailView";
import { HealthHistoryPopup } from "@/components/diagnostics/HealthHistoryPopup";
import { HeatMapPopup } from "@/components/diagnostics/HeatMapPopup";
import { IssueCard } from "@/components/diagnostics/IssueCard";
import { LatencyAnalysisPopup } from "@/components/diagnostics/LatencyAnalysisPopup";
import { SummaryCard } from "@/components/diagnostics/SummaryCard";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import type { ActionSummary } from "@/lib/diagnostics/actionSummaries";
import type { HeatMapVariant } from "@/lib/diagnostics/heatMapData";
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
import type {
  HealthCheckProbeRecord,
  HealthCheckProbeType,
  HealthCheckRunResult,
} from "@/lib/diagnostics/healthCheckEngine";
import { computeLatencyPercentiles } from "@/lib/diagnostics/latencyTracker";
import {
  resolveActionSeverity,
  resolveLogSeverity,
  resolveTraceSeverity,
  type DiagnosticsSeverity,
} from "@/lib/diagnostics/diagnosticsSeverity";
import { formatDiagnosticsTimestamp } from "@/lib/diagnostics/timeFormat";
import type { LogEntry } from "@/lib/logging";
import { getTraceTitle } from "@/lib/tracing/traceFormatter";
import type { TraceEvent } from "@/lib/tracing/types";
import { cn } from "@/lib/utils";

export type EvidenceType = "Problems" | "Actions" | "Logs" | "Traces";
export type IndicatorFilter = ContributorKey | "All";
type OriginFilter = "User" | "System";
type SeverityFilter = "All" | "Errors" | "Warnings" | "Info";

type DiagnosticsLogEntry = LogEntry;
type DiagnosticsTraceEntry = TraceEvent;

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
  logs: DiagnosticsLogEntry[];
  errorLogs: DiagnosticsLogEntry[];
  traceEvents: DiagnosticsTraceEntry[];
  actionSummaries: ActionSummary[];
  onShareAll: () => void | Promise<void>;
  onShareFiltered: (
    entries: Array<DiagnosticsLogEntry | ActionSummary | DiagnosticsTraceEntry>,
  ) => void | Promise<void>;
  onClearAll: () => void;
  onRetryConnection: () => void;
  defaultEvidenceTypes?: Set<EvidenceType>;
  connectionCallbacks?: ConnectionActionsCallbacks;
  deviceInfo?: DeviceDetailInfo | null;
  healthCheckRunning?: boolean;
  onRunHealthCheck?: () => void;
  lastHealthCheckResult?: HealthCheckRunResult | null;
  liveHealthCheckProbes?: Partial<Record<HealthCheckProbeType, HealthCheckProbeRecord>> | null;
};

const CONTRIBUTOR_ORDER: ContributorKey[] = ["App", "REST", "FTP"];
const PAGE_SIZE = 200;
const SEVERITY_FILTERS: SeverityFilter[] = ["All", "Errors", "Warnings", "Info"];

const HEALTH_STATE_COLOR: Record<HealthState, string> = {
  Healthy: "text-success",
  Degraded: "text-amber-500",
  Unhealthy: "text-destructive",
  Idle: "text-muted-foreground",
  Unavailable: "text-muted-foreground",
};

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

const normalizeFilter = (value: string) => value.trim().toLowerCase();

const matchesFilter = (filterText: string, fields: Array<string | null | undefined>) => {
  const normalized = normalizeFilter(filterText);
  if (!normalized) return true;
  return fields.filter(Boolean).join(" ").toLowerCase().includes(normalized);
};

const formatRelative = (timestampMs: number) => {
  const elapsed = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (elapsed < 60) return `${elapsed}s ago`;
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return `${minutes}m ${seconds}s ago`;
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

const traceContributor = (entry: DiagnosticsTraceEntry): ContributorKey | null => {
  const type = entry.type as string | undefined;
  if (type === "rest-request" || type === "rest-response") return "REST";
  if (type === "ftp-operation") return "FTP";
  if (type === "error") return "App";
  return null;
};

const traceOrigin = (entry: DiagnosticsTraceEntry): OriginFilter | null => {
  const origin = entry.origin as string | undefined;
  if (origin === "user") return "User";
  if (origin === "system" || origin === "automatic") return "System";
  return null;
};

const actionOrigin = (summary: ActionSummary): OriginFilter | null => {
  if (summary.origin === "user") return "User";
  if (summary.origin === "system") return "System";
  return null;
};

const isTraceFailure = (entry: DiagnosticsTraceEntry) => {
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

const traceProblemTitle = (entry: DiagnosticsTraceEntry) => {
  const type = entry.type as string | undefined;
  const data = entry.data as Record<string, unknown> | undefined;
  if (type === "rest-response" && data) {
    const method = typeof data.method === "string" ? data.method : "REST";
    const path = typeof data.path === "string" ? data.path : "";
    return `${method} ${path} failed`.trim().slice(0, 80);
  }
  if (type === "ftp-operation" && data) {
    const operation = typeof data.operation === "string" ? data.operation : "FTP";
    const path = typeof data.path === "string" ? data.path : "";
    return `${operation} ${path} failed`.trim().slice(0, 80);
  }
  return "Operation failed";
};

const humanizeProblem = (problem: Problem | null) => {
  if (!problem) {
    return {
      headline: "Something needs attention",
      supportingText: null as string | null,
    };
  }

  if (problem.contributor === "REST") {
    const lowerTitle = problem.title.toLowerCase();
    const headline = lowerTitle.includes("/v1/info")
      ? "Could not reach the device"
      : "A device request could not be completed";
    return {
      headline,
      supportingText: problem.causeHint ?? problem.title,
    };
  }

  if (problem.contributor === "FTP") {
    return {
      headline: "A file transfer action could not be completed",
      supportingText: problem.causeHint ?? problem.title,
    };
  }

  return {
    headline: problem.title,
    supportingText: problem.causeHint,
  };
};

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
  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-medium">{label}:</span> <span className="font-mono">{activity.operation}</span>
      {" · "}
      <span>{activity.result}</span>
      {" · "}
      <span>{relative}</span>
      {absolute}
    </p>
  );
};

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
  const sessionTotal =
    profile === "expanded" && health.totalOperations > 0 ? ` · ${health.totalOperations} session total` : "";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-left text-xs transition-colors hover:border-primary/40",
        isActive && "border-primary/40 bg-primary/5",
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
      <span className="truncate text-muted-foreground">{`${phrase}${sessionTotal}`.trim()}</span>
    </button>
  );
};

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
}: {
  activeTypes: Set<EvidenceType>;
  onToggle: (type: EvidenceType) => void;
  indicatorFilter: IndicatorFilter;
  onIndicatorFilterChange: (filter: IndicatorFilter) => void;
  severityFilter: SeverityFilter;
  onSeverityFilterChange: (filter: SeverityFilter) => void;
  searchText: string;
  onSearchChange: (value: string) => void;
  originFilters: Set<OriginFilter>;
  onOriginToggle: (origin: OriginFilter) => void;
  isCompact: boolean;
  isMedium: boolean;
  refineCount: number;
}) => {
  const [refineOpen, setRefineOpen] = useState(false);
  const types: EvidenceType[] = ["Problems", "Actions", "Logs", "Traces"];
  const origins: OriginFilter[] = ["User", "System"];
  const contributors: IndicatorFilter[] = ["All", "App", "REST", "FTP"];
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
      {origins.map((origin) =>
        renderFilterButton(
          origin,
          origin,
          originFilters.has(origin),
          () => onOriginToggle(origin),
          `origin-toggle-${origin.toLowerCase()}`,
        ),
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
    <section
      className={cn("rounded-xl border border-border/70 bg-muted/20", isCompact ? "p-3 space-y-3" : "p-4 space-y-3")}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Filters</p>
          <SectionHelp label="Filters" testId="filters-help">
            Choose evidence types and narrow the visible activity by contributor, origin, severity, or text.
          </SectionHelp>
        </div>

        {showRefineButton ? (
          <button
            type="button"
            onClick={() => setRefineOpen((value) => !value)}
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
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {types.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => onToggle(type)}
            aria-pressed={activeTypes.has(type)}
            data-testid={`evidence-toggle-${type.toLowerCase()}`}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              activeTypes.has(type)
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary/40",
            )}
          >
            {type}
          </button>
        ))}
      </div>

      {showSearchInline ? (
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="text"
            placeholder="Filter entries"
            value={searchText}
            onChange={(event) => onSearchChange(event.target.value)}
            className="h-8 pl-9 pr-9 text-xs"
            data-testid="diagnostics-filter-input"
          />
          {searchText ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSearchChange("")}
              className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 p-0"
              aria-label="Clear filter"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      ) : null}

      {showAdvancedInline ? (
        <div className="space-y-2">
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

      {showRefineButton && refineOpen ? (
        <div className="space-y-2" data-testid="refine-panel">
          {isCompact ? (
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="text"
                placeholder="Filter entries"
                value={searchText}
                onChange={(event) => onSearchChange(event.target.value)}
                className="h-8 pl-9 pr-9 text-xs"
                data-testid="diagnostics-filter-input"
              />
              {searchText ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onSearchChange("")}
                  className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 p-0"
                  aria-label="Clear filter"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>
          ) : null}
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
    </section>
  );
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

  const [showDetails, setShowDetails] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [activePopup, setActivePopup] = useState<ActivePopup>(null);
  const [activeDetailView, setActiveDetailView] = useState<ActiveDetailView>(null);
  const [activeTypes, setActiveTypes] = useState<Set<EvidenceType>>(
    () => defaultEvidenceTypes ?? new Set(["Problems", "Actions"]),
  );
  const [indicatorFilter, setIndicatorFilter] = useState<IndicatorFilter>("All");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("All");
  const [searchText, setSearchText] = useState("");
  const [originFilters, setOriginFilters] = useState<Set<OriginFilter>>(() => new Set<OriginFilter>());
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [expandedProblemId, setExpandedProblemId] = useState<string | null>(null);
  const [focusedScope, setFocusedScope] = useState<string | null>(null);

  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setShowDetails(false);
    setShowAnalysis(false);
    setActivePopup(null);
    setActiveDetailView(null);
    setActiveTypes(defaultEvidenceTypes ?? new Set(["Problems", "Actions"]));
    setIndicatorFilter("All");
    setSeverityFilter("All");
    setSearchText("");
    setOriginFilters(new Set<OriginFilter>());
    setVisibleCount(PAGE_SIZE);
    setExpandedProblemId(null);
    setFocusedScope(null);
  }, [defaultEvidenceTypes, open]);

  const handleOriginToggle = useCallback((origin: OriginFilter) => {
    setOriginFilters((previous) => {
      const next = new Set(previous);
      if (next.has(origin)) {
        next.delete(origin);
      } else {
        next.add(origin);
      }
      return next;
    });
  }, []);

  const handleToggleType = useCallback((type: EvidenceType) => {
    setActiveTypes((previous) => {
      const next = new Set(previous);
      if (next.has(type)) {
        if (next.size === 1) return previous;
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
    setVisibleCount(PAGE_SIZE);
  }, []);

  const handleResetFilters = useCallback(() => {
    setActiveTypes(new Set<EvidenceType>(["Problems", "Actions"]));
    setIndicatorFilter("All");
    setSeverityFilter("All");
    setSearchText("");
    setOriginFilters(new Set<OriginFilter>());
    setVisibleCount(PAGE_SIZE);
    setFocusedScope(null);
  }, []);

  const allStreamEntries = useMemo(() => {
    const entries: StreamEntry[] = [];
    const originActive = originFilters.size === 0 || originFilters.size === 2;
    const problemTraceIds = new Set<string>();

    if (activeTypes.has("Problems")) {
      for (const entry of traceEvents) {
        if (!isTraceFailure(entry)) continue;
        const contributor = traceContributor(entry);
        if (!contributor || contributor === "App") continue;
        if (indicatorFilter !== "All" && indicatorFilter !== contributor) continue;
        const title = traceProblemTitle(entry);
        if (!matchesFilter(searchText, [title, entry.id, entry.timestamp])) continue;
        if (!originActive) {
          const origin = traceOrigin(entry);
          if (origin && !originFilters.has(origin)) continue;
        }
        const severity = resolveLogSeverity("error");
        if (!matchesSeverityFilter(severityFilter, severity)) continue;
        problemTraceIds.add(entry.id);
        entries.push({
          id: entry.id,
          kind: "problem",
          timestamp: entry.timestamp,
          contributor,
          origin: traceOrigin(entry),
          severity,
          data: { id: entry.id, message: title, timestamp: entry.timestamp, level: "error", details: entry.data },
        });
      }

      for (const entry of errorLogs) {
        const severity = resolveLogSeverity(entry.level);
        if (!matchesSeverityFilter(severityFilter, severity)) continue;
        if (indicatorFilter !== "All" && indicatorFilter !== "App") continue;
        if (!matchesFilter(searchText, [entry.message, entry.level, entry.id])) continue;
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

    if (activeTypes.has("Actions")) {
      for (const summary of actionSummaries) {
        const severity = resolveActionSeverity(summary.outcome);
        if (!matchesSeverityFilter(severityFilter, severity)) continue;
        if (indicatorFilter !== "All") {
          const matchedContributor = summary.effects?.some((effect) => {
            if (indicatorFilter === "REST") return effect.type === "REST";
            if (indicatorFilter === "FTP") return effect.type === "FTP";
            if (indicatorFilter === "App") return effect.type === "ERROR";
            return false;
          });
          if (!matchedContributor) continue;
        }
        if (
          !matchesFilter(searchText, [
            summary.actionName,
            summary.correlationId,
            summary.origin,
            summary.outcome,
            formatDiagnosticsTimestamp(summary.startTimestamp),
          ])
        ) {
          continue;
        }
        if (!originActive) {
          const origin = actionOrigin(summary);
          if (origin && !originFilters.has(origin)) continue;
        }
        entries.push({
          id: summary.correlationId,
          kind: "action",
          timestamp: summary.startTimestamp ?? summary.endTimestamp ?? new Date(0).toISOString(),
          contributor: null,
          origin: actionOrigin(summary),
          severity,
          data: summary,
        });
      }
    }

    if (activeTypes.has("Logs")) {
      for (const entry of logs) {
        const severity = resolveLogSeverity(entry.level);
        if (!matchesSeverityFilter(severityFilter, severity)) continue;
        if (!matchesFilter(searchText, [entry.message, entry.level, entry.id])) continue;
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

    if (activeTypes.has("Traces")) {
      const recentEntries = traceEvents.slice(-200).reverse();
      for (const entry of recentEntries) {
        if (problemTraceIds.has(entry.id)) continue;
        const severity = resolveTraceSeverity(entry);
        if (!matchesSeverityFilter(severityFilter, severity)) continue;
        if (!matchesFilter(searchText, [getTraceTitle(entry), entry.id, entry.timestamp])) continue;
        if (indicatorFilter !== "All") {
          const contributor = traceContributor(entry);
          if (contributor !== indicatorFilter) continue;
        }
        if (!originActive) {
          const origin = traceOrigin(entry);
          if (origin && !originFilters.has(origin)) continue;
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

    entries.sort((left, right) => (right.timestamp < left.timestamp ? -1 : right.timestamp > left.timestamp ? 1 : 0));

    return entries;
  }, [
    actionSummaries,
    activeTypes,
    errorLogs,
    indicatorFilter,
    logs,
    originFilters,
    searchText,
    severityFilter,
    traceEvents,
  ]);

  const streamEntries = useMemo(() => allStreamEntries.slice(0, visibleCount), [allStreamEntries, visibleCount]);
  const hasMoreEntries = allStreamEntries.length > visibleCount;
  const hasVisibleEntries = streamEntries.length > 0;
  const newestEntryTimestamp = streamEntries[0]?.timestamp ?? allStreamEntries[0]?.timestamp ?? null;
  const refineCount = originFilters.size + (searchText.trim() !== "" ? 1 : 0);
  const entryFilterCount = refineCount + (indicatorFilter !== "All" ? 1 : 0) + (severityFilter !== "All" ? 1 : 0);
  const isFiltersModified =
    !activeTypes.has("Problems") ||
    !activeTypes.has("Actions") ||
    activeTypes.has("Logs") ||
    activeTypes.has("Traces") ||
    indicatorFilter !== "All" ||
    severityFilter !== "All" ||
    originFilters.size > 0 ||
    searchText.trim() !== "";

  const activeFilterPills = [
    indicatorFilter !== "All" ? `Contributor: ${indicatorFilter}` : null,
    severityFilter !== "All" ? describeSeverityFilter(severityFilter) : null,
    originFilters.size > 0 ? `Origin: ${Array.from(originFilters).join(" + ")}` : null,
    searchText.trim() !== "" ? `Search: “${searchText.trim()}”` : null,
  ].filter(Boolean) as string[];

  const handleShareFiltered = useCallback(() => {
    void onShareFiltered(allStreamEntries.map((entry) => entry.data));
  }, [allStreamEntries, onShareFiltered]);

  const handleRevealAnalysis = useCallback(() => {
    setShowDetails(true);
    setShowAnalysis(true);
    setFocusedScope((previous) => previous ?? "Analysis");
  }, []);

  const latency = computeLatencyPercentiles();
  const hasLatencyData = latency.sampleCount > 0;

  const isOffline = healthState.connectivity === "Offline" || healthState.connectivity === "Not yet connected";
  const isUnhealthy = !isOffline && (healthState.state === "Unhealthy" || healthState.state === "Degraded");
  const needsAttention = isOffline || isUnhealthy;
  const connectedLabel = healthState.connectedDeviceLabel ?? "C64U";
  const humanizedProblem = humanizeProblem(healthState.primaryProblem);

  const primaryContributor = healthState.primaryProblem?.contributor ?? (isOffline ? "REST" : null);
  const lastMeaningfulActivity = needsAttention
    ? healthState.primaryProblem
      ? `${healthState.primaryProblem.contributor} issue recorded ${formatRelative(healthState.primaryProblem.timestampMs)}`
      : healthState.lastRestActivity
        ? `Last device check ${formatRelative(healthState.lastRestActivity.timestampMs)}`
        : healthState.lastFtpActivity
          ? `Last file transfer activity ${formatRelative(healthState.lastFtpActivity.timestampMs)}`
          : "No recent activity recorded"
    : null;

  const summaryCard = isOffline
    ? {
        badgeLabel: "Health",
        title: "Unhealthy",
        titleToneClassName: "text-destructive",
        statusGlyph: HEALTH_GLYPHS.Unavailable,
        statusGlyphClassName: HEALTH_STATE_COLOR.Unavailable,
        headline: healthState.host,
        supportingText: "Contributor: REST",
      }
    : isUnhealthy
      ? {
          badgeLabel: "Health",
          title: healthState.state,
          titleToneClassName: HEALTH_STATE_COLOR[healthState.state],
          statusGlyph: HEALTH_GLYPHS[healthState.state],
          statusGlyphClassName: HEALTH_STATE_COLOR[healthState.state],
          headline: connectedLabel,
          supportingText: primaryContributor ? `Contributor: ${primaryContributor}` : null,
        }
      : {
          badgeLabel: "Health",
          title: "Healthy",
          titleToneClassName: "text-success",
          statusGlyph: HEALTH_GLYPHS[healthState.state === "Idle" ? "Healthy" : healthState.state],
          statusGlyphClassName: "text-success",
          headline: connectedLabel,
          supportingText: "All systems working",
        };

  const scopeLabel = (() => {
    if (activeDetailView === "device") return "Showing: Device detail";
    if (activeDetailView === "config-drift") return "Showing: Config drift";
    if (activeDetailView === "health-check") return "Showing: Health check detail";
    if (searchText.trim() !== "") return "Showing: Search results";
    if (indicatorFilter !== "All") return `Showing: ${indicatorFilter} issues`;
    if (focusedScope) return `Showing: ${focusedScope}`;
    return null;
  })();

  const handleSummaryPrimaryAction = useCallback(() => {
    if (isOffline) {
      setFocusedScope("Connection recovery");
      setShowDetails(true);
      onRetryConnection();
      return;
    }

    if (isUnhealthy) {
      setFocusedScope("Problem details");
      setShowDetails(true);
      return;
    }

    setFocusedScope("Health check");
    setShowDetails(true);
    onRunHealthCheck?.();
  }, [isOffline, isUnhealthy, onRetryConnection, onRunHealthCheck]);

  const handleContributorFocus = useCallback((contributor: IndicatorFilter) => {
    setShowDetails(true);
    setIndicatorFilter((previous) => {
      const nextValue = previous === contributor ? "All" : contributor;
      setFocusedScope(nextValue === "All" ? null : `${nextValue} issues`);
      return nextValue;
    });
  }, []);

  const handleSheetOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && activePopup) {
        setActivePopup(null);
        return;
      }
      onOpenChange(nextOpen);
    },
    [activePopup, onOpenChange],
  );

  const recoveryFirst = isRecoveryFirstState(healthState.connectivity);

  return (
    <TooltipProvider delayDuration={150}>
      <AppSheet open={open} onOpenChange={handleSheetOpenChange}>
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
            <div className="min-w-0 space-y-1">
              <AppSheetTitle>Diagnostics</AppSheetTitle>
              <AppSheetDescription className="max-w-full pr-8" data-testid="diagnostics-subtitle">
                Health status, focused details, and deeper analysis when you ask for it.
              </AppSheetDescription>
            </div>
          </AppSheetHeader>

          <div className="flex-1 overflow-auto">
            <div className={cn("space-y-3", isCompact ? "px-3 py-3" : "px-4 py-4")}>
              <SummaryCard
                badgeLabel={summaryCard.badgeLabel}
                title={summaryCard.title}
                titleToneClassName={summaryCard.titleToneClassName}
                statusGlyph={summaryCard.statusGlyph}
                statusGlyphClassName={summaryCard.statusGlyphClassName}
                headline={summaryCard.headline}
                supportingText={summaryCard.supportingText}
                isCompact={isCompact}
                primaryAction={{
                  label: isOffline
                    ? "Fix / Retry"
                    : isUnhealthy
                      ? "View issue"
                      : healthCheckRunning
                        ? "Running health check…"
                        : "Run health check",
                  onClick: handleSummaryPrimaryAction,
                  testId: "show-details-button",
                }}
                secondaryAction={
                  isUnhealthy && onRunHealthCheck
                    ? {
                        label: healthCheckRunning ? "Running health check…" : "Run health check",
                        onClick: () => {
                          setFocusedScope("Health check");
                          setShowDetails(true);
                          onRunHealthCheck();
                        },
                        testId: "run-health-check-button",
                        variant: "ghost",
                      }
                    : undefined
                }
              >
                {lastMeaningfulActivity ? (
                  <div
                    className="rounded-lg border border-border/60 bg-background/60 px-3 py-2"
                    data-testid="summary-activity-line"
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Last meaningful activity
                    </p>
                    <p className="mt-1 text-sm text-foreground">{lastMeaningfulActivity}</p>
                  </div>
                ) : null}

                {needsAttention ? (
                  <div className="space-y-2" data-testid="summary-contributors">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Contributors
                    </p>
                    <div className="space-y-2">
                      {CONTRIBUTOR_ORDER.map((key) => (
                        <ContributorRow
                          key={key}
                          contributorKey={key}
                          health={healthState.contributors[key]}
                          isActive={indicatorFilter === key}
                          onClick={() => handleContributorFocus(key)}
                          profile={profile}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}

                {needsAttention ? (
                  <IssueCard
                    title={humanizedProblem.headline}
                    supportingText={healthState.primaryProblem?.causeHint ?? humanizedProblem.supportingText}
                    contributor={primaryContributor ?? "App"}
                    isCompact={isCompact}
                  />
                ) : null}
              </SummaryCard>

              {showDetails ? (
                <section
                  className={cn(
                    "rounded-xl border border-border/80 bg-card",
                    isCompact ? "p-3 space-y-3" : "p-4 space-y-4",
                  )}
                  data-testid="diagnostics-details-layer"
                >
                  <button type="button" className="sr-only" aria-expanded="true" data-testid="technical-details-toggle">
                    Details open
                  </button>
                  <div data-testid="technical-details-card" className="space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          Details
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Health history, latency, contributor detail, and recovery actions stay here.
                        </p>
                        {scopeLabel ? (
                          <p className="text-xs font-medium text-foreground" data-testid="diagnostics-scope-label">
                            {scopeLabel}
                          </p>
                        ) : null}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleRevealAnalysis}
                        data-testid="tools-card-toggle"
                      >
                        <span data-testid="analyse-button">Analyse</span>
                      </Button>
                    </div>

                    <div className="rounded-lg border border-border/60 bg-background/50 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="space-y-1">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                            Connection
                          </p>
                          <p className="text-sm font-medium text-foreground">{healthState.host}</p>
                          <p className="text-xs text-muted-foreground">{connectedLabel}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setActiveDetailView("device")}
                            data-testid="open-device-detail"
                          >
                            <Activity className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                            Device detail
                          </Button>
                          {lastHealthCheckResult ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setActiveDetailView("health-check")}
                              data-testid="open-health-check-detail"
                            >
                              Health check detail
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border/60 bg-background/50 p-3 space-y-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Contributor detail
                      </p>
                      <div className="space-y-1.5">
                        <LastActivityRow label="REST" activity={healthState.lastRestActivity} profile={profile} />
                        <LastActivityRow label="FTP" activity={healthState.lastFtpActivity} profile={profile} />
                      </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      {onRunHealthCheck ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={onRunHealthCheck}
                          disabled={healthCheckRunning}
                          data-testid="technical-run-health-check-button"
                        >
                          {healthCheckRunning ? "Running health check…" : "Run health check"}
                        </Button>
                      ) : null}

                      {hasLatencyData ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setActivePopup("latency")}
                          data-testid="latency-summary-row"
                        >
                          <Clock className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                          Latency analysis
                        </Button>
                      ) : null}

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setActivePopup("history")}
                        data-testid="health-history-row"
                      >
                        <BarChart2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                        Health history
                      </Button>
                    </div>

                    {connectionCallbacks ? (
                      <div className="rounded-lg border border-border/60 bg-background/50 p-3">
                        <ConnectionActionsRegion
                          connectivity={healthState.connectivity}
                          currentHost={healthState.host}
                          callbacks={connectionCallbacks}
                          defaultExpanded={recoveryFirst}
                        />
                      </div>
                    ) : healthState.connectivity === "Offline" || healthState.connectivity === "Not yet connected" ? (
                      <div className="rounded-lg border border-border/60 bg-background/50 p-3">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={onRetryConnection}
                          data-testid="retry-connection-button"
                        >
                          Retry connection
                        </Button>
                      </div>
                    ) : null}

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
                </section>
              ) : null}

              {showAnalysis ? (
                <section
                  className={cn(
                    "rounded-xl border border-border/80 bg-background/60",
                    isCompact ? "p-3 space-y-4" : "p-4 space-y-4",
                  )}
                  data-testid="diagnostics-analysis-layer"
                >
                  <div data-testid="tools-card" className="space-y-4">
                    {scopeLabel ? (
                      <p className="text-xs font-medium text-foreground" data-testid="diagnostics-analysis-scope-label">
                        {scopeLabel}
                      </p>
                    ) : null}

                    <QuickFocusControls
                      activeTypes={activeTypes}
                      onToggle={handleToggleType}
                      indicatorFilter={indicatorFilter}
                      onIndicatorFilterChange={(filter) => handleContributorFocus(filter)}
                      severityFilter={severityFilter}
                      onSeverityFilterChange={setSeverityFilter}
                      searchText={searchText}
                      onSearchChange={setSearchText}
                      originFilters={originFilters}
                      onOriginToggle={handleOriginToggle}
                      isCompact={isCompact}
                      isMedium={isMedium}
                      refineCount={refineCount}
                    />

                    <EvidenceFullView
                      totalCount={allStreamEntries.length}
                      visibleCount={streamEntries.length}
                      newestEntryLabel={formatStreamTimestamp(newestEntryTimestamp)}
                      activeFilterPills={activeFilterPills}
                      isFiltersModified={isFiltersModified}
                      onResetFilters={handleResetFilters}
                      isCompact={isCompact}
                    >
                      <div ref={streamRef} className="space-y-1.5" data-testid="diagnostics-stream-region">
                        {streamEntries.length === 0 && !isFiltersModified ? (
                          <p className="text-sm text-muted-foreground" data-testid="diagnostics-empty-message">
                            No diagnostics yet. Health information will appear here after activity occurs.
                          </p>
                        ) : null}

                        {streamEntries.length === 0 && isFiltersModified ? (
                          <p className="text-sm text-muted-foreground" data-testid="diagnostics-no-results-message">
                            No entries match the current filters.
                          </p>
                        ) : null}

                        {streamEntries.map((entry) => {
                          if (entry.kind === "problem") {
                            const isExpanded = expandedProblemId === entry.data.id;
                            return (
                              <DiagnosticsListItem
                                key={`problem-${entry.data.id}`}
                                testId={`problem-${entry.data.id}`}
                                mode="log"
                                severity={resolveLogSeverity(entry.data.level)}
                                title={entry.data.message}
                                timestamp={entry.data.timestamp}
                                defaultExpanded={isExpanded}
                              >
                                <div className="space-y-2">
                                  <div className="flex items-center gap-2">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-destructive">
                                      Problem
                                    </p>
                                    <span className="text-xs font-medium text-muted-foreground">
                                      {entry.contributor}
                                    </span>
                                  </div>
                                  <p className="text-sm font-medium break-words whitespace-normal">
                                    {entry.data.message}
                                  </p>
                                  {entry.data.details ? (
                                    <pre className="overflow-x-auto whitespace-pre text-xs text-muted-foreground">
                                      {JSON.stringify(entry.data.details, null, 2)}
                                    </pre>
                                  ) : null}
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
                                  <p className="text-sm font-medium break-words whitespace-normal">
                                    {entry.data.message}
                                  </p>
                                  {entry.data.details ? (
                                    <pre className="overflow-x-auto whitespace-pre text-xs text-muted-foreground">
                                      {JSON.stringify(entry.data.details, null, 2)}
                                    </pre>
                                  ) : null}
                                </div>
                              </DiagnosticsListItem>
                            );
                          }

                          return (
                            <DiagnosticsListItem
                              key={`trace-${entry.data.id}`}
                              testId={`trace-${entry.data.id}`}
                              mode="trace"
                              severity={resolveTraceSeverity(entry.data)}
                              title={getTraceTitle(entry.data)}
                              timestamp={entry.data.timestamp}
                            >
                              <pre className="overflow-x-auto whitespace-pre text-xs text-muted-foreground">
                                {JSON.stringify(entry.data, null, 2)}
                              </pre>
                            </DiagnosticsListItem>
                          );
                        })}

                        {hasMoreEntries ? (
                          <div className="flex justify-center pt-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                              data-testid="load-older-entries"
                            >
                              Load older entries
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </EvidenceFullView>

                    <div className="border-t border-border/70 pt-3" data-testid="diagnostics-action-shelf">
                      <div
                        className={cn(
                          "items-center gap-1.5",
                          isCompact ? "grid grid-cols-1" : "flex flex-wrap justify-end",
                        )}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void onShareAll()}
                          data-testid="diagnostics-share-all"
                          aria-label="Share all"
                          className={cn("h-8 gap-1.5 px-2", isCompact && "w-full min-w-0 justify-center")}
                        >
                          <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                          {isCompact ? "All" : "Share all"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!hasVisibleEntries}
                          onClick={handleShareFiltered}
                          data-testid="diagnostics-share-filtered"
                          aria-label="Share filtered"
                          className={cn("h-8 gap-1.5 px-2", isCompact && "w-full min-w-0 justify-center")}
                        >
                          <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                          {isCompact ? "Filtered" : "Share filtered"}
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className={cn("h-8 gap-1.5 px-2", isCompact && "w-full min-w-0 justify-center")}
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
                              REST activity
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => setActivePopup("heatmap-FTP")}
                              data-testid="open-heatmap-ftp"
                            >
                              <BarChart2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                              FTP activity
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => setActivePopup("heatmap-CONFIG")}
                              data-testid="open-heatmap-config"
                            >
                              <BarChart2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                              Config activity
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => {
                                setShowDetails(true);
                                setActiveDetailView("config-drift");
                                setFocusedScope("Config drift");
                              }}
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
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        </AppSheetContent>

        <LatencyAnalysisPopup open={activePopup === "latency"} onClose={() => setActivePopup(null)} />
        <HealthHistoryPopup open={activePopup === "history"} onClose={() => setActivePopup(null)} />
        {activePopup === "heatmap-REST" || activePopup === "heatmap-FTP" || activePopup === "heatmap-CONFIG" ? (
          <HeatMapPopup
            open
            onClose={() => setActivePopup(null)}
            variant={activePopup.replace("heatmap-", "") as HeatMapVariant}
            traceEvents={traceEvents}
          />
        ) : null}
      </AppSheet>
    </TooltipProvider>
  );
}
