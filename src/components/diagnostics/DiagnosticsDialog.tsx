/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronDown, ChevronRight, Filter, MoreHorizontal, Share2, Trash2 } from "lucide-react";

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
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import type { ActionSummary } from "@/lib/diagnostics/actionSummaries";
import { getC64APIConfigSnapshot, updateC64APIConfig } from "@/lib/c64api";
import { buildBaseUrlFromDeviceHost } from "@/lib/c64api";
import type {
  HealthCheckProbeRecord,
  HealthCheckProbeType,
  HealthCheckRunResult,
} from "@/lib/diagnostics/healthCheckEngine";
import { getStoredFtpPort, setStoredFtpPort } from "@/lib/ftp/ftpConfig";
import type { DiagnosticsPanelKey } from "@/lib/diagnostics/diagnosticsOverlay";
import {
  resolveActionSeverity,
  resolveLogSeverity,
  resolveTraceSeverity,
  type DiagnosticsSeverity,
} from "@/lib/diagnostics/diagnosticsSeverity";
import type { HeatMapVariant } from "@/lib/diagnostics/heatMapData";
import { HEALTH_GLYPHS, type ContributorKey, type OverallHealthState } from "@/lib/diagnostics/healthModel";
import { formatDiagnosticsTimestamp } from "@/lib/diagnostics/timeFormat";
import type { LogEntry } from "@/lib/logging";
import { getTraceTitle } from "@/lib/tracing/traceFormatter";
import type { TraceEvent } from "@/lib/tracing/types";
import { cn } from "@/lib/utils";
import type { DeviceDetailInfo } from "@/components/diagnostics/DeviceDetailView";
import { ActionExpandedContent } from "./ActionExpandedContent";
import { ConfigDriftView } from "./ConfigDriftView";
import { HeatMapPopup } from "./HeatMapPopup";
import { HealthCheckDetailView } from "./HealthCheckDetailView";
import { HealthHistoryPopup } from "./HealthHistoryPopup";
import { LatencyAnalysisPopup } from "./LatencyAnalysisPopup";

export type EvidenceType = "Problems" | "Actions" | "Logs" | "Traces";
type SeverityFilter = "All" | "Errors" | "Warnings" | "Info";
type ContributorFilter = "All" | ContributorKey;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  healthState: OverallHealthState;
  logs: LogEntry[];
  errorLogs: LogEntry[];
  traceEvents: TraceEvent[];
  actionSummaries: ActionSummary[];
  onShareAll: () => void | Promise<void>;
  onShareFiltered: (entries: Array<LogEntry | ActionSummary | TraceEvent>) => void | Promise<void>;
  onClearAll: () => void;
  onRetryConnection: () => void;
  defaultEvidenceTypes?: Set<EvidenceType>;
  connectionCallbacks?: unknown;
  deviceInfo?: DeviceDetailInfo | null;
  healthCheckRunning?: boolean;
  onRunHealthCheck?: () => void;
  lastHealthCheckResult?: HealthCheckRunResult | null;
  liveHealthCheckProbes?: Partial<Record<HealthCheckProbeType, HealthCheckProbeRecord>> | null;
  requestedPanel?: DiagnosticsPanelKey | null;
};

type EvidenceEntry = {
  id: string;
  type: EvidenceType;
  title: string;
  detail: string | null;
  contributor: ContributorKey | null;
  severity: DiagnosticsSeverity;
  timestamp: string;
  payload: LogEntry | ActionSummary | TraceEvent;
};

type ConnectionDraft = {
  host: string;
  httpPort: string;
  ftpPort: string;
};

const EVIDENCE_ORDER: EvidenceType[] = ["Problems", "Actions", "Logs", "Traces"];
const DEFAULT_TYPES = new Set<EvidenceType>(["Problems", "Actions"]);
const HEADER_TONE: Record<OverallHealthState["state"], string> = {
  Healthy: "text-success",
  Degraded: "text-amber-500",
  Unhealthy: "text-destructive",
  Idle: "text-muted-foreground",
  Unavailable: "text-muted-foreground",
};

const SEVERITY_DOT_CLASS: Record<DiagnosticsSeverity, string> = {
  error: "bg-destructive",
  warn: "bg-amber-500",
  info: "bg-blue-500",
  debug: "bg-muted-foreground",
};

const formatRelativeTime = (timestampMs: number | null) => {
  if (timestampMs === null || Number.isNaN(timestampMs)) return "Last check -";
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  if (minutes === 0) {
    return `Last check ${seconds}s ago`;
  }
  return `Last check ${minutes}m ${seconds}s ago`;
};

const matchesSeverity = (filter: SeverityFilter, severity: DiagnosticsSeverity) => {
  if (filter === "All") return true;
  if (filter === "Errors") return severity === "error";
  if (filter === "Warnings") return severity === "warn";
  return severity === "info" || severity === "debug";
};

const getTraceContributor = (entry: TraceEvent): ContributorKey | null => {
  if (entry.type === "rest-request" || entry.type === "rest-response") return "REST";
  if (entry.type === "ftp-operation") return "FTP";
  if (entry.type === "error") return "App";
  return null;
};

const getActionContributor = (summary: ActionSummary): ContributorKey | null => {
  if (!Array.isArray(summary.effects) || summary.effects.length === 0) return null;
  if (summary.effects.some((effect) => effect.type === "ERROR")) return "App";
  if (summary.effects.some((effect) => effect.type === "REST")) return "REST";
  if (summary.effects.some((effect) => effect.type === "FTP")) return "FTP";
  return null;
};

const isTraceProblem = (entry: TraceEvent) => {
  if (entry.type === "rest-response") {
    const status = typeof entry.data.status === "number" ? entry.data.status : null;
    const error = typeof entry.data.error === "string" ? entry.data.error.trim() : "";
    return (status !== null && status >= 400) || error.length > 0;
  }
  if (entry.type === "ftp-operation") {
    const result = typeof entry.data.result === "string" ? entry.data.result : "";
    const error = typeof entry.data.error === "string" ? entry.data.error.trim() : "";
    return result === "failure" || error.length > 0;
  }
  return false;
};

const getProblemTitle = (entry: TraceEvent) => {
  if (entry.type === "rest-response") {
    const method = typeof entry.data.method === "string" ? entry.data.method : "REST";
    const path = typeof entry.data.path === "string" ? entry.data.path : "/";
    return `${method} ${path}`.trim();
  }
  if (entry.type === "ftp-operation") {
    const operation = typeof entry.data.operation === "string" ? entry.data.operation : "FTP";
    const path = typeof entry.data.path === "string" ? entry.data.path : "/";
    return `${operation} ${path}`.trim();
  }
  return "Problem";
};

const summarizeAction = (summary: ActionSummary) => {
  const restCount = summary.effects?.filter((effect) => effect.type === "REST").length ?? 0;
  const ftpCount = summary.effects?.filter((effect) => effect.type === "FTP").length ?? 0;
  const errCount = summary.effects?.filter((effect) => effect.type === "ERROR").length ?? 0;
  const parts = [] as string[];
  if (restCount > 0) parts.push(`REST ${restCount}`);
  if (ftpCount > 0) parts.push(`FTP ${ftpCount}`);
  if (errCount > 0) parts.push(`ERR ${errCount}`);
  return parts.join(" · ") || summary.outcome;
};

const formatActionDuration = (durationMs: number | null | undefined) => {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) return null;
  return `${Math.round(durationMs)}ms`;
};

const formatNetworkHost = (hostname: string | null | undefined, port: number | null | undefined) => {
  if (!hostname) return null;
  if (typeof port === "number" && Number.isFinite(port)) {
    return `${hostname}:${port}`;
  }
  return hostname;
};

const getActionPrimaryEffect = (summary: ActionSummary) => {
  return summary.effects?.find((effect) => effect.type === "REST" || effect.type === "FTP") ?? null;
};

const buildActionTitle = (summary: ActionSummary) => {
  const primary = getActionPrimaryEffect(summary);
  if (!primary) return summary.actionName;
  if (primary.type === "REST") {
    const host = formatNetworkHost(primary.hostname, primary.port);
    const path = primary.normalizedPath ?? `${primary.path}${primary.query ?? ""}`;
    return [primary.method, host, path].filter(Boolean).join(" ");
  }
  const host = formatNetworkHost(primary.hostname, primary.port);
  return [primary.command ?? primary.operation.toUpperCase(), host ? `${host}${primary.path}` : primary.path]
    .filter(Boolean)
    .join(" ");
};

const buildActionDetail = (summary: ActionSummary) => {
  const primary = getActionPrimaryEffect(summary);
  const parts: string[] = [];
  const effectSummary = summarizeAction(summary);
  const title = buildActionTitle(summary);
  if (summary.actionName !== title) {
    parts.push(summary.actionName);
  }
  if (effectSummary !== summary.outcome) {
    parts.push(effectSummary);
  }
  if (primary?.type === "REST") {
    if (typeof primary.status === "number") parts.push(`HTTP ${primary.status}`);
    if (primary.error) parts.push(primary.error);
    const duration = formatActionDuration(primary.durationMs);
    if (duration) parts.push(duration);
  } else if (primary?.type === "FTP") {
    if (primary.result) parts.push(primary.result);
    if (primary.error) parts.push(primary.error);
    const duration = formatActionDuration(primary.durationMs);
    if (duration) parts.push(duration);
  }
  return parts.join(" · ") || effectSummary;
};

const parseConnectionSnapshot = () => {
  const snapshot = getC64APIConfigSnapshot();
  const ftpPort = getStoredFtpPort();
  const deviceHost = snapshot.deviceHost.replace(/^https?:\/\//, "");
  const match = /^(.+):(\d+)$/.exec(deviceHost);
  if (match) {
    return {
      host: match[1],
      httpPort: Number(match[2]),
      ftpPort,
    };
  }

  try {
    const url = new URL(snapshot.baseUrl, window.location.origin);
    const derivedPort = url.port ? Number(url.port) : 80;
    return {
      host: deviceHost || url.hostname,
      httpPort: derivedPort,
      ftpPort,
    };
  } catch {
    return {
      host: deviceHost || "c64u",
      httpPort: 80,
      ftpPort,
    };
  }
};

const isValidHostname = (value: string) => {
  const trimmed = value.trim();
  const ipv4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
  const hostname =
    /^(?=.{1,253}$)(localhost|[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)$/;
  return ipv4.test(trimmed) || hostname.test(trimmed);
};

const isValidPort = (value: string) => {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= 65535;
};

const getLastCheckTimestamp = (
  lastHealthCheckResult: HealthCheckRunResult | null | undefined,
  healthState: OverallHealthState,
) => {
  if (lastHealthCheckResult?.endTimestamp) {
    const parsed = Date.parse(lastHealthCheckResult.endTimestamp);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (healthState.lastRestActivity) return healthState.lastRestActivity.timestampMs;
  if (healthState.lastFtpActivity) return healthState.lastFtpActivity.timestampMs;
  return null;
};

const SurfaceHeader = ({ title, onClose }: { title: string; onClose: () => void }) => (
  <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
    <h2 className="text-sm font-semibold">{title}</h2>
    <Button type="button" size="sm" variant="ghost" onClick={onClose}>
      Close
    </Button>
  </div>
);

const FilterChip = ({ label }: { label: string }) => (
  <span className="rounded-full border border-border/70 bg-background px-2 py-0.5 text-[11px] font-medium leading-4">
    {label}
  </span>
);

const FilterToggleChip = ({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className={cn(
      "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
      checked ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground",
    )}
  >
    {checked ? "✓ " : ""}
    {label}
  </button>
);

const formatJsonBlock = (value: unknown) => {
  if (value == null) return null;
  const formatted = JSON.stringify(value, null, 2);
  if (!formatted || formatted === "{}" || formatted === "[]") return null;
  return formatted;
};

const getLogDetailsRecord = (entry: LogEntry) => {
  if (!entry.details || typeof entry.details !== "object" || Array.isArray(entry.details)) return null;
  return { ...(entry.details as Record<string, unknown>) };
};

const getLogErrorInfo = (entry: LogEntry) => {
  const details = getLogDetailsRecord(entry);
  const nestedError =
    details?.error && typeof details.error === "object" && !Array.isArray(details.error)
      ? { ...(details.error as Record<string, unknown>) }
      : null;
  const errorName =
    typeof details?.errorName === "string"
      ? details.errorName
      : typeof nestedError?.name === "string"
        ? nestedError.name
        : null;
  const errorMessage = typeof nestedError?.message === "string" ? nestedError.message : null;
  const errorStack =
    typeof details?.errorStack === "string"
      ? details.errorStack
      : typeof nestedError?.stack === "string"
        ? nestedError.stack
        : null;

  if (details) {
    delete details.errorName;
    delete details.errorStack;
  }

  if (nestedError && details) {
    delete nestedError.name;
    delete nestedError.message;
    delete nestedError.stack;
    if (Object.keys(nestedError).length > 0) {
      details.error = nestedError;
    } else {
      delete details.error;
    }
  }

  return { details, errorMessage, errorName, errorStack };
};

const formatLogHeadline = (entry: LogEntry) => `${entry.level.toUpperCase()} ${entry.message || "(empty message)"}`;

const getLogSecondaryDetail = (entry: LogEntry) => {
  const { errorMessage, errorName } = getLogErrorInfo(entry);
  if (errorName) return errorName;
  if (errorMessage && errorMessage !== entry.message) return errorMessage;
  return null;
};

const formatLogExpandedDetail = (entry: LogEntry) => {
  const { details, errorMessage, errorName, errorStack } = getLogErrorInfo(entry);
  const sections = [formatLogHeadline(entry)];

  if (errorName) {
    sections.push(
      errorMessage && errorMessage !== entry.message
        ? `Exception: ${errorName}: ${errorMessage}`
        : `Exception: ${errorName}`,
    );
  } else if (errorMessage && errorMessage !== entry.message) {
    sections.push(`Exception message: ${errorMessage}`);
  }

  if (errorStack) {
    sections.push(`Stack trace:\n${errorStack}`);
  }

  const formattedDetails = formatJsonBlock(details);
  if (formattedDetails) {
    sections.push(`Details:\n${formattedDetails}`);
  }

  return sections.length > 1 ? sections.join("\n\n") : null;
};

const getEntryExpandedDetail = (entry: EvidenceEntry): ReactNode | null => {
  if (entry.type === "Logs" || (entry.type === "Problems" && "level" in entry.payload)) {
    return formatLogExpandedDetail(entry.payload as LogEntry);
  }

  if (entry.type === "Actions") {
    const summary = entry.payload as ActionSummary;
    return <ActionExpandedContent summary={summary} />;
  }

  const trace = entry.payload as TraceEvent;
  return formatJsonBlock({
    type: trace.type,
    origin: trace.origin,
    correlationId: trace.correlationId,
    data: trace.data,
  });
};

const EvidenceRow = ({
  entry,
  expanded,
  onToggle,
}: {
  entry: EvidenceEntry;
  expanded: boolean;
  onToggle: () => void;
}) => {
  const expandedDetail = getEntryExpandedDetail(entry);
  const canExpand = expandedDetail !== null;

  const content = (
    <>
      <span
        className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", SEVERITY_DOT_CLASS[entry.severity])}
        aria-label={entry.severity}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{entry.title}</p>
            {entry.detail ? <p className="truncate text-xs text-muted-foreground">{entry.detail}</p> : null}
            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span>{entry.type}</span>
              {entry.contributor ? <span>· {entry.contributor}</span> : null}
              <span>· {formatDiagnosticsTimestamp(entry.timestamp)}</span>
            </div>
          </div>
          {canExpand ? (
            <span className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true">
              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </span>
          ) : null}
        </div>
        {expanded && expandedDetail ? (
          typeof expandedDetail === "string" ? (
            <pre
              className="mt-2 overflow-x-auto rounded-md border border-border/70 bg-muted/30 p-2 text-[11px] leading-4 text-foreground"
              data-testid={`evidence-detail-${entry.id}`}
            >
              {expandedDetail}
            </pre>
          ) : (
            <div
              className="mt-2 rounded-md border border-border/70 bg-muted/30 p-2"
              data-testid={`evidence-detail-${entry.id}`}
            >
              {expandedDetail}
            </div>
          )
        ) : null}
      </div>
    </>
  );

  if (!canExpand) {
    return (
      <div
        className="flex items-start gap-2 rounded-lg border border-border/70 bg-background px-2.5 py-1.5"
        data-testid={`evidence-row-${entry.id}`}
      >
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="flex w-full items-start gap-2 rounded-lg border border-border/70 bg-background px-2.5 py-1.5 text-left"
      data-testid={`evidence-row-${entry.id}`}
      onClick={onToggle}
      aria-expanded={expanded}
    >
      {content}
    </button>
  );
};

const FilterEditorSurface = ({
  open,
  onOpenChange,
  profile,
  selectedTypes,
  onSelectedTypesChange,
  contributor,
  onContributorChange,
  severity,
  onSeverityChange,
  totalCount,
  visibleCount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: "compact" | "medium" | "expanded";
  selectedTypes: Set<EvidenceType>;
  onSelectedTypesChange: (value: Set<EvidenceType>) => void;
  contributor: ContributorFilter;
  onContributorChange: (value: ContributorFilter) => void;
  severity: SeverityFilter;
  onSeverityChange: (value: SeverityFilter) => void;
  totalCount: number;
  visibleCount: number;
}) => {
  const isSidePanel = profile === "expanded";

  const toggleType = (type: EvidenceType, checked: boolean) => {
    const next = new Set(selectedTypes);
    if (checked) {
      next.add(type);
    } else {
      next.delete(type);
    }
    if (next.size === 0) return;
    onSelectedTypesChange(next);
  };

  const contentClassName = isSidePanel
    ? "fixed bottom-4 right-4 top-4 z-[60] flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-[28px] border bg-background shadow-2xl"
    : "fixed inset-x-0 bottom-0 z-[60] flex max-h-[70dvh] flex-col overflow-hidden rounded-t-[28px] border border-b-0 bg-background shadow-2xl";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[59] bg-black/70" />
        <DialogPrimitive.Content className={contentClassName} data-testid="filters-editor-surface">
          <DialogPrimitive.Title className="sr-only">Diagnostics filters</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Filter diagnostics activity by type, contributor, and severity.
          </DialogPrimitive.Description>
          <SurfaceHeader title="Filters" onClose={() => onOpenChange(false)} />
          <div className="flex-1 overflow-y-auto px-4 py-3">
            <p className="mb-3 text-xs text-muted-foreground" data-testid="filters-result-count">
              {visibleCount} of {totalCount}
            </p>

            <div className="space-y-3">
              <section className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Activity types
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {EVIDENCE_ORDER.map((type) => (
                    <FilterToggleChip
                      key={type}
                      label={type}
                      checked={selectedTypes.has(type)}
                      onChange={(checked) => toggleType(type, checked)}
                    />
                  ))}
                </div>
              </section>

              <section className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Contributor</p>
                <div className="flex flex-wrap gap-1.5">
                  {(["All", "App", "REST", "FTP"] as const).map((option) => (
                    <FilterToggleChip
                      key={option}
                      label={option}
                      checked={contributor === option}
                      onChange={(checked) => {
                        if (!checked) return;
                        onContributorChange(option);
                      }}
                    />
                  ))}
                </div>
              </section>

              <section className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Severity</p>
                <div className="flex flex-wrap gap-1.5">
                  {(["All", "Errors", "Warnings", "Info"] as const).map((option) => (
                    <FilterToggleChip
                      key={option}
                      label={option}
                      checked={severity === option}
                      onChange={(checked) => {
                        if (!checked) return;
                        onSeverityChange(option);
                      }}
                    />
                  ))}
                </div>
              </section>

              <section className="space-y-1.5 border-t border-border/70 pt-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Quick filters</p>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      onSeverityChange("Errors");
                      onSelectedTypesChange(new Set(EVIDENCE_ORDER));
                      onContributorChange("All");
                    }}
                    data-testid="quick-filter-errors"
                  >
                    Errors only
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      onSeverityChange("All");
                      onSelectedTypesChange(new Set<EvidenceType>(["Problems"]));
                      onContributorChange("All");
                    }}
                    data-testid="quick-filter-problems"
                  >
                    Problems only
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      onSeverityChange("All");
                      onSelectedTypesChange(new Set(DEFAULT_TYPES));
                      onContributorChange("All");
                    }}
                    data-testid="quick-filter-reset"
                  >
                    Reset
                  </Button>
                </div>
              </section>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

const ConnectionSurface = ({
  open,
  onOpenChange,
  mode,
  draft,
  setDraft,
  onStartEdit,
  onSave,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "view" | "edit";
  draft: ConnectionDraft;
  setDraft: (value: ConnectionDraft) => void;
  onStartEdit: () => void;
  onSave: () => void;
  error: string | null;
}) => {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[61] bg-black/70" />
        <DialogPrimitive.Content
          className="fixed inset-x-0 bottom-0 top-[16dvh] z-[62] flex flex-col overflow-hidden rounded-t-[28px] border border-b-0 bg-background shadow-2xl sm:left-1/2 sm:right-auto sm:top-1/2 sm:h-auto sm:max-h-[80dvh] sm:w-[28rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[28px] sm:border"
          data-testid={mode === "view" ? "connection-view-surface" : "connection-edit-surface"}
        >
          <DialogPrimitive.Title className="sr-only">
            {mode === "view" ? "Connection details" : "Edit connection"}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {mode === "view"
              ? "Review the current host and ports used for the connected device."
              : "Update the host and ports used for the connected device."}
          </DialogPrimitive.Description>
          <SurfaceHeader title="Connection" onClose={() => onOpenChange(false)} />
          {mode === "view" ? (
            <div className="space-y-3 px-4 py-3 text-sm">
              <div className="grid grid-cols-[4rem_1fr] gap-y-2">
                <span className="text-muted-foreground">Host</span>
                <span className="font-medium text-foreground">{draft.host}</span>
                <span className="text-muted-foreground">HTTP</span>
                <span className="font-medium text-foreground">{draft.httpPort}</span>
                <span className="text-muted-foreground">FTP</span>
                <span className="font-medium text-foreground">{draft.ftpPort}</span>
              </div>
              <Button type="button" onClick={onStartEdit} data-testid="connection-view-edit">
                Edit
              </Button>
            </div>
          ) : (
            <div className="space-y-3 px-4 py-3 text-sm">
              <label className="block space-y-1">
                <span className="text-muted-foreground">Host</span>
                <Input
                  value={draft.host}
                  onChange={(event) => setDraft({ ...draft, host: event.target.value })}
                  data-testid="connection-edit-host"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-muted-foreground">HTTP</span>
                <Input
                  value={draft.httpPort}
                  inputMode="numeric"
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      httpPort: event.target.value.replace(/[^0-9]/g, ""),
                    })
                  }
                  data-testid="connection-edit-http"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-muted-foreground">FTP</span>
                <Input
                  value={draft.ftpPort}
                  inputMode="numeric"
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      ftpPort: event.target.value.replace(/[^0-9]/g, ""),
                    })
                  }
                  data-testid="connection-edit-ftp"
                />
              </label>
              {error ? (
                <p className="text-sm text-destructive" data-testid="connection-edit-error">
                  {error}
                </p>
              ) : null}
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  data-testid="connection-edit-cancel"
                >
                  Cancel
                </Button>
                <Button type="button" onClick={onSave} data-testid="connection-edit-save">
                  Save
                </Button>
              </div>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

const ConfigDriftSurface = ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[61] bg-black/70" />
        <DialogPrimitive.Content
          className="fixed inset-x-0 bottom-0 top-[12dvh] z-[62] flex flex-col overflow-hidden rounded-t-[28px] border border-b-0 bg-background shadow-2xl sm:left-1/2 sm:right-auto sm:top-1/2 sm:h-auto sm:max-h-[80dvh] sm:w-[34rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[28px] sm:border"
          data-testid="config-drift-surface"
        >
          <DialogPrimitive.Title className="sr-only">Config drift</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Review runtime configuration drift against persisted settings.
          </DialogPrimitive.Description>
          <SurfaceHeader title="Config Drift" onClose={() => onOpenChange(false)} />
          <div className="flex-1 overflow-y-auto px-4 py-3">
            <ConfigDriftView onBack={() => onOpenChange(false)} />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
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
  healthCheckRunning = false,
  onRunHealthCheck,
  lastHealthCheckResult = null,
  liveHealthCheckProbes = null,
  requestedPanel = null,
}: Props) {
  const { profile } = useDisplayProfile();
  const [headerExpanded, setHeaderExpanded] = useState(false);
  const [expandedEvidenceId, setExpandedEvidenceId] = useState<string | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<Set<EvidenceType>>(defaultEvidenceTypes ?? DEFAULT_TYPES);
  const [contributor, setContributor] = useState<ContributorFilter>("All");
  const [severity, setSeverity] = useState<SeverityFilter>("All");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [connectionMode, setConnectionMode] = useState<"view" | "edit">("view");
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [connectionDraft, setConnectionDraft] = useState<ConnectionDraft>({
    host: "c64u",
    httpPort: "80",
    ftpPort: "21",
  });
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [latencyOpen, setLatencyOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [configDriftOpen, setConfigDriftOpen] = useState(false);
  const [heatMapVariant, setHeatMapVariant] = useState<HeatMapVariant | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressHandledRef = useRef(false);

  const allEntries = useMemo(() => {
    const items: EvidenceEntry[] = [];

    for (const entry of errorLogs) {
      items.push({
        id: `problem-log-${entry.id}`,
        type: "Problems",
        title: formatLogHeadline(entry),
        detail: getLogSecondaryDetail(entry),
        contributor: "App",
        severity: resolveLogSeverity(entry.level),
        timestamp: entry.timestamp,
        payload: entry,
      });
    }

    for (const entry of traceEvents) {
      if (!isTraceProblem(entry)) continue;
      const detail =
        typeof entry.data.error === "string"
          ? entry.data.error
          : typeof entry.data.status === "number"
            ? `HTTP ${entry.data.status}`
            : null;
      items.push({
        id: `problem-trace-${entry.id}`,
        type: "Problems",
        title: getProblemTitle(entry),
        detail,
        contributor: getTraceContributor(entry),
        severity: resolveTraceSeverity(entry),
        timestamp: entry.timestamp,
        payload: entry,
      });
    }

    for (const summary of actionSummaries) {
      items.push({
        id: `action-${summary.correlationId}`,
        type: "Actions",
        title: buildActionTitle(summary),
        detail: buildActionDetail(summary),
        contributor: getActionContributor(summary),
        severity: resolveActionSeverity(summary.outcome),
        timestamp: summary.startTimestamp ?? summary.endTimestamp ?? new Date(0).toISOString(),
        payload: summary,
      });
    }

    for (const entry of logs) {
      items.push({
        id: `log-${entry.id}`,
        type: "Logs",
        title: formatLogHeadline(entry),
        detail: getLogSecondaryDetail(entry),
        contributor: "App",
        severity: resolveLogSeverity(entry.level),
        timestamp: entry.timestamp,
        payload: entry,
      });
    }

    for (const entry of traceEvents) {
      items.push({
        id: `trace-${entry.id}`,
        type: "Traces",
        title: getTraceTitle(entry),
        detail: null,
        contributor: getTraceContributor(entry),
        severity: resolveTraceSeverity(entry),
        timestamp: entry.timestamp,
        payload: entry,
      });
    }

    return items.sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
  }, [actionSummaries, errorLogs, logs, traceEvents]);

  useEffect(() => {
    if (!open) return;
    setHeaderExpanded(false);
    setSelectedTypes(defaultEvidenceTypes ?? new Set(DEFAULT_TYPES));
    setContributor("All");
    setSeverity("All");
    setFiltersOpen(false);
    setConnectionOpen(false);
    setConnectionMode("view");
    setConnectionError(null);
    setLatencyOpen(false);
    setHistoryOpen(false);
    setConfigDriftOpen(false);
    setHeatMapVariant(null);
    setOverflowOpen(false);
    setExpandedEvidenceId(null);

    const snapshot = parseConnectionSnapshot();
    setConnectionDraft({
      host: snapshot.host,
      httpPort: String(snapshot.httpPort),
      ftpPort: String(snapshot.ftpPort),
    });
  }, [defaultEvidenceTypes, open]);

  useEffect(() => {
    if (!open) {
      setFiltersOpen(false);
      setConnectionOpen(false);
      setLatencyOpen(false);
      setHistoryOpen(false);
      setConfigDriftOpen(false);
      setHeatMapVariant(null);
      setOverflowOpen(false);
    }
  }, [open]);

  useEffect(() => {
    if (healthCheckRunning) {
      setHeaderExpanded(true);
    }
  }, [healthCheckRunning]);

  useEffect(() => {
    if (!open || !requestedPanel) return;
    setHeaderExpanded(requestedPanel === "overview");
    setLatencyOpen(requestedPanel === "latency");
    setHistoryOpen(requestedPanel === "history");
    setConfigDriftOpen(requestedPanel === "config-drift");
    setHeatMapVariant(
      requestedPanel === "rest-heatmap"
        ? "REST"
        : requestedPanel === "ftp-heatmap"
          ? "FTP"
          : requestedPanel === "config-heatmap"
            ? "CONFIG"
            : null,
    );
  }, [open, requestedPanel]);

  const filteredEntries = useMemo(
    () =>
      allEntries.filter((entry) => {
        if (!selectedTypes.has(entry.type)) return false;
        if (contributor !== "All" && entry.contributor !== contributor) return false;
        return matchesSeverity(severity, entry.severity);
      }),
    [allEntries, contributor, selectedTypes, severity],
  );

  const visibleCount = filteredEntries.length;
  const totalCount = allEntries.length;
  const displayEntries = filteredEntries.slice(0, 20);
  const lastCheckTimestamp = getLastCheckTimestamp(lastHealthCheckResult, healthState);
  const healthDetailAvailable =
    headerExpanded || healthCheckRunning || liveHealthCheckProbes !== null || lastHealthCheckResult !== null;
  const connectionLabel = `${healthState.connectedDeviceLabel ?? "C64U"} · ${connectionDraft.host}:${connectionDraft.httpPort}`;
  const activeFilterLabels = useMemo(() => {
    const labels: string[] = [];
    if (severity !== "All") labels.push(severity);
    const selectedTypeLabels = EVIDENCE_ORDER.filter((type) => selectedTypes.has(type));
    if (selectedTypeLabels.length !== EVIDENCE_ORDER.length) {
      labels.push(...selectedTypeLabels);
    }
    if (contributor !== "All") labels.push(contributor);
    return labels;
  }, [contributor, selectedTypes, severity]);

  const filterBarChips = activeFilterLabels.slice(0, 2);
  const overflowChipCount = Math.max(0, activeFilterLabels.length - 2);

  const openConnectionView = useCallback(() => {
    setConnectionMode("view");
    setConnectionError(null);
    setConnectionOpen(true);
  }, []);

  const openConnectionEdit = useCallback(() => {
    setConnectionMode("edit");
    setConnectionError(null);
    setConnectionOpen(true);
  }, []);

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleDevicePointerDown = () => {
    longPressHandledRef.current = false;
    clearLongPress();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressHandledRef.current = true;
      openConnectionEdit();
    }, 450);
  };

  const handleDevicePointerUp = () => {
    if (longPressHandledRef.current) {
      clearLongPress();
      return;
    }
    clearLongPress();
    openConnectionView();
  };

  const saveConnection = () => {
    const nextHost = connectionDraft.host.trim();
    if (!isValidHostname(nextHost)) {
      setConnectionError("Enter a valid host.");
      return;
    }
    if (!isValidPort(connectionDraft.httpPort)) {
      setConnectionError("HTTP must be 1 to 65535.");
      return;
    }
    if (!isValidPort(connectionDraft.ftpPort)) {
      setConnectionError("FTP must be 1 to 65535.");
      return;
    }

    const password = getC64APIConfigSnapshot().password;
    const deviceHost = `${nextHost}:${connectionDraft.httpPort}`;
    updateC64APIConfig(buildBaseUrlFromDeviceHost(deviceHost), password, deviceHost);
    setStoredFtpPort(Number(connectionDraft.ftpPort));
    setConnectionError(null);
    setConnectionOpen(false);
    onRetryConnection();
  };

  const handleShareFiltered = () => {
    void onShareFiltered(filteredEntries.map((entry) => entry.payload));
  };

  return (
    <>
      <AppSheet open={open} onOpenChange={onOpenChange}>
        <AppSheetContent className="flex min-h-0 flex-col overflow-hidden" data-testid="diagnostics-sheet">
          <AppSheetHeader className="space-y-0 px-4 pb-2 pt-3">
            <AppSheetTitle>Diagnostics</AppSheetTitle>
            <AppSheetDescription className="sr-only">Diagnostic activity and health status.</AppSheetDescription>
          </AppSheetHeader>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4">
            {/* Phase 1: Compact header */}
            <section className="shrink-0 rounded-xl border border-border/70 bg-card" data-testid="diagnostics-header">
              <div className="flex items-start justify-between gap-2 px-3 py-2">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p
                    className={cn("text-sm font-semibold", HEADER_TONE[healthState.state])}
                    data-testid="diagnostics-health-line"
                  >
                    {HEALTH_GLYPHS[healthState.state]} {healthState.state}
                  </p>
                  <button
                    type="button"
                    className="block truncate text-left text-xs font-medium text-foreground underline-offset-2 hover:underline"
                    data-testid="diagnostics-device-line"
                    onPointerDown={handleDevicePointerDown}
                    onPointerUp={handleDevicePointerUp}
                    onPointerLeave={clearLongPress}
                    onPointerCancel={clearLongPress}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      openConnectionEdit();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openConnectionView();
                      }
                    }}
                  >
                    {connectionLabel}
                  </button>
                  <p className="text-xs text-muted-foreground" data-testid="diagnostics-last-check-line">
                    {formatRelativeTime(lastCheckTimestamp)}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-1 h-7 text-xs"
                    onClick={() => {
                      setHeaderExpanded(true);
                      onRunHealthCheck?.();
                    }}
                    disabled={!onRunHealthCheck || healthCheckRunning}
                    data-testid="run-health-check"
                  >
                    {healthCheckRunning ? "Running health check" : "Run health check"}
                  </Button>
                </div>
                {lastHealthCheckResult || liveHealthCheckProbes !== null || healthCheckRunning ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => setHeaderExpanded((value) => !value)}
                    data-testid="diagnostics-header-toggle"
                    aria-expanded={headerExpanded}
                  >
                    {headerExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                  </Button>
                ) : null}
              </div>
              {headerExpanded && healthDetailAvailable ? (
                <div className="border-t border-border/70 px-3 py-2" data-testid="diagnostics-header-expanded">
                  <HealthCheckDetailView
                    result={lastHealthCheckResult}
                    liveProbes={liveHealthCheckProbes}
                    isRunning={healthCheckRunning}
                    onBack={() => setHeaderExpanded(false)}
                  />
                </div>
              ) : null}
            </section>

            {/* Phase 3: Unified filter bar */}
            <div
              className="mt-2 flex items-center gap-1.5 overflow-hidden rounded-full border border-border/70 bg-card px-2.5 py-1.5 text-xs"
              data-testid="filters-collapsed-bar"
            >
              <span className="shrink-0 font-semibold text-foreground">Filters</span>
              <span className="shrink-0 text-muted-foreground">·</span>
              <span className="shrink-0 text-muted-foreground" data-testid="filters-result-count">
                {visibleCount} of {totalCount}
              </span>
              <div className="min-w-0 flex-1 overflow-hidden whitespace-nowrap">
                <div className="flex items-center gap-1 overflow-hidden">
                  {filterBarChips.map((chip) => (
                    <FilterChip key={chip} label={chip} />
                  ))}
                  {overflowChipCount > 0 ? <FilterChip label={`+${overflowChipCount}`} /> : null}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => setFiltersOpen(true)}
                data-testid="open-filters-editor"
              >
                <Filter className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Sections index — quick access to all diagnostics surfaces */}
            <section className="mt-2 shrink-0" data-testid="diagnostics-sections-index">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Sections</p>
              <div className="flex flex-wrap gap-1" data-testid="sections-index-buttons">
                <button
                  type="button"
                  className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setConfigDriftOpen(true)}
                  data-testid="sections-index-config-drift"
                >
                  Config drift
                </button>
                <button
                  type="button"
                  className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setLatencyOpen(true)}
                  data-testid="sections-index-latency"
                >
                  Latency
                </button>
                <button
                  type="button"
                  className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setHistoryOpen(true)}
                  data-testid="sections-index-health-history"
                >
                  Health history
                </button>
                <button
                  type="button"
                  className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setHeatMapVariant("REST")}
                  data-testid="sections-index-rest-heatmap"
                >
                  REST heat map
                </button>
                <button
                  type="button"
                  className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setHeatMapVariant("FTP")}
                  data-testid="sections-index-ftp-heatmap"
                >
                  FTP heat map
                </button>
                <button
                  type="button"
                  className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setHeatMapVariant("CONFIG")}
                  data-testid="sections-index-config-heatmap"
                >
                  Config heat map
                </button>
              </div>
            </section>

            {/* Phase 2: Evidence list (immediately visible) */}
            <section className="mt-2 min-h-0 flex-1" data-testid="evidence-panel">
              <p
                className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                data-testid="evidence-heading"
              >
                Activity
              </p>
              <p className="mb-2 text-[11px] text-muted-foreground" data-testid="activity-kinds-line">
                Problems, actions, logs, and traces
              </p>
              <div className="max-h-72 space-y-1.5 overflow-y-auto" data-testid="evidence-list">
                {displayEntries.map((entry) => (
                  <Fragment key={entry.id}>
                    <EvidenceRow
                      entry={entry}
                      expanded={expandedEvidenceId === entry.id}
                      onToggle={() => setExpandedEvidenceId((current) => (current === entry.id ? null : entry.id))}
                    />
                  </Fragment>
                ))}
                {displayEntries.length === 0 ? (
                  <p className="py-2 text-xs text-muted-foreground">No matching activity.</p>
                ) : null}
              </div>
            </section>

            {/* Phase 6: Compact controls */}
            <section className="mt-2 shrink-0 space-y-2" data-testid="diagnostics-controls">
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setConfigDriftOpen(true)}
                  data-testid="open-config-drift-screen"
                >
                  Config drift
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setLatencyOpen(true)}
                  data-testid="open-latency-screen"
                >
                  Latency
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setHistoryOpen(true)}
                  data-testid="open-timeline-screen"
                >
                  Health history
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setHeatMapVariant("REST")}
                  data-testid="open-rest-heatmap-screen"
                >
                  REST heat map
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setHeatMapVariant("FTP")}
                  data-testid="open-ftp-heatmap-screen"
                >
                  FTP heat map
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setHeatMapVariant("CONFIG")}
                  data-testid="open-config-heatmap-screen"
                >
                  Config heat map
                </Button>
                <div className="relative">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => setOverflowOpen((v) => !v)}
                    data-testid="diagnostics-overflow-menu"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                  {overflowOpen ? (
                    <div className="absolute bottom-full right-0 z-10 mb-1 min-w-[10rem] rounded-lg border border-border bg-background py-1 shadow-lg">
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted"
                        onClick={() => {
                          setOverflowOpen(false);
                          void onShareAll();
                        }}
                        data-testid="diagnostics-share-all"
                      >
                        <Share2 className="h-3.5 w-3.5" />
                        Share all
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted"
                        onClick={() => {
                          setOverflowOpen(false);
                          handleShareFiltered();
                        }}
                        data-testid="diagnostics-share-filtered"
                      >
                        <Share2 className="h-3.5 w-3.5" />
                        Share filtered
                      </button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-destructive hover:bg-muted"
                            data-testid="diagnostics-clear-all-trigger"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Clear all
                          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent surface="confirmation">
                          <AlertDialogHeader>
                            <AlertDialogTitle>Clear diagnostics?</AlertDialogTitle>
                            <AlertDialogDescription>This removes current diagnostics entries.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={onClearAll} data-testid="diagnostics-clear-all-confirm">
                              Clear
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
          </div>
        </AppSheetContent>
      </AppSheet>

      <FilterEditorSurface
        open={open && filtersOpen}
        onOpenChange={setFiltersOpen}
        profile={profile}
        selectedTypes={selectedTypes}
        onSelectedTypesChange={setSelectedTypes}
        contributor={contributor}
        onContributorChange={setContributor}
        severity={severity}
        onSeverityChange={setSeverity}
        totalCount={totalCount}
        visibleCount={visibleCount}
      />

      <ConnectionSurface
        open={open && connectionOpen}
        onOpenChange={setConnectionOpen}
        mode={connectionMode}
        draft={connectionDraft}
        setDraft={setConnectionDraft}
        onStartEdit={() => setConnectionMode("edit")}
        onSave={saveConnection}
        error={connectionError}
      />

      <ConfigDriftSurface open={open && configDriftOpen} onOpenChange={setConfigDriftOpen} />
      <LatencyAnalysisPopup open={open && latencyOpen} onClose={() => setLatencyOpen(false)} />
      <HealthHistoryPopup open={open && historyOpen} onClose={() => setHistoryOpen(false)} />
      <HeatMapPopup
        open={open && heatMapVariant !== null}
        onClose={() => setHeatMapVariant(null)}
        variant={heatMapVariant ?? "REST"}
        traceEvents={traceEvents}
      />
    </>
  );
}
