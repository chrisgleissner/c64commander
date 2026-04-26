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
import { useNavigate } from "react-router-dom";

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
  AppDialog,
  AppDialogBody,
  AppDialogContent,
  AppDialogDescription,
  AppDialogFooter,
  AppDialogHeader,
  AppDialogTitle,
  AppSheet,
  AppSheetBody,
  AppSheetContent,
  AppSheetDescription,
  AppSheetHeader,
  AppSheetTitle,
} from "@/components/ui/app-surface";
import { Button } from "@/components/ui/button";
import { SavedDeviceEditorFields } from "@/components/devices/SavedDeviceEditorFields";
import { Input } from "@/components/ui/input";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { useSavedDevices } from "@/hooks/useSavedDevices";
import type { ActionSummary } from "@/lib/diagnostics/actionSummaries";
import { getC64APIConfigSnapshot, updateC64APIConfig } from "@/lib/c64api";
import { buildBaseUrlFromDeviceHost } from "@/lib/c64api";
import { buildDeviceHostWithHttpPort, getDeviceHostHttpPort, stripPortFromDeviceHost } from "@/lib/c64api/hostConfig";
import type {
  HealthCheckProbeRecord,
  HealthCheckProbeType,
  HealthCheckRunResult,
} from "@/lib/diagnostics/healthCheckEngine";
import { getStoredFtpPort, setStoredFtpPort } from "@/lib/ftp/ftpConfig";
import { getStoredTelnetPort, setStoredTelnetPort } from "@/lib/telnet/telnetConfig";
import type { DiagnosticsPanelKey } from "@/lib/diagnostics/diagnosticsOverlay";
import type { HealthHistoryEntry } from "@/lib/diagnostics/healthHistory";
import {
  resolveActionSeverity,
  resolveLogSeverity,
  resolveTraceSeverity,
  type DiagnosticsSeverity,
} from "@/lib/diagnostics/diagnosticsSeverity";
import {
  formatDiagnosticsVerifiedDeviceLabel,
  hasDiagnosticsDeviceAttribution,
  readDiagnosticsDeviceAttribution,
  resolveDiagnosticsDeviceLabel,
  shouldShowDiagnosticsDeviceUi,
  type DiagnosticsDeviceAttribution,
} from "@/lib/diagnostics/deviceAttribution";
import type { HeatMapVariant } from "@/lib/diagnostics/heatMapData";
import { HEALTH_GLYPHS, type ContributorKey, type OverallHealthState } from "@/lib/diagnostics/healthModel";
import { formatDiagnosticsTimestamp } from "@/lib/diagnostics/timeFormat";
import type { LogEntry } from "@/lib/logging";
import {
  buildSavedDeviceEditorDraft,
  type SavedDeviceEditorDraft,
  validateSavedDevicePorts,
} from "@/lib/savedDevices/deviceEditor";
import { buildSavedDevicePrimaryLabel, updateSavedDevice, validateSavedDeviceName } from "@/lib/savedDevices/store";
import { getTraceTitle } from "@/lib/tracing/traceFormatter";
import type { TraceEvent } from "@/lib/tracing/types";
import { cn } from "@/lib/utils";
import { validateDeviceHost } from "@/lib/validation/connectionValidation";
import type { DeviceDetailInfo } from "@/components/diagnostics/DeviceDetailView";
import { ActionExpandedContent } from "./ActionExpandedContent";
import { ConfigDriftView } from "./ConfigDriftView";
import { DecisionStateView } from "./DecisionStateView";
import { HeatMapPopup } from "./HeatMapPopup";
import { HealthCheckDetailView } from "./HealthCheckDetailView";
import { HealthHistoryPopup } from "./HealthHistoryPopup";
import { LatencyAnalysisPopup } from "./LatencyAnalysisPopup";

export type EvidenceType = "Problems" | "Actions" | "Logs" | "Traces";
type SeverityFilter = "All" | "Errors" | "Warnings" | "Info";
type ContributorFilter = "All" | ContributorKey;
type DeviceFilter = string | null;

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
  healthHistory?: Readonly<HealthHistoryEntry[]>;
  requestedPanel?: DiagnosticsPanelKey | null;
  repairRunning?: boolean;
  onRepair?: () => void | Promise<void>;
};

type EvidenceEntry = {
  id: string;
  type: EvidenceType;
  title: string;
  detail: string | null;
  contributor: ContributorKey | null;
  severity: DiagnosticsSeverity;
  timestamp: string;
  device: DiagnosticsDeviceAttribution | null;
  deviceLabel: string | null;
  payload: LogEntry | ActionSummary | TraceEvent;
};

type DeviceFilterOption = {
  id: string;
  label: string;
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
  if (entry.type === "telnet-operation") return "TELNET";
  if (entry.type === "error") return "App";
  return null;
};

const getActionContributor = (summary: ActionSummary): ContributorKey | null => {
  if (!Array.isArray(summary.effects) || summary.effects.length === 0) return null;
  if (summary.effects.some((effect) => effect.type === "TELNET")) return "TELNET";
  if (summary.effects.some((effect) => effect.type === "REST")) return "REST";
  if (summary.effects.some((effect) => effect.type === "FTP")) return "FTP";
  if (summary.effects.some((effect) => effect.type === "ERROR")) return "App";
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
  if (entry.type === "telnet-operation") {
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
  if (entry.type === "telnet-operation") {
    return typeof entry.data.actionLabel === "string" ? entry.data.actionLabel : "Telnet action";
  }
  return "Problem";
};

const summarizeAction = (summary: ActionSummary) => {
  const restCount = summary.effects?.filter((effect) => effect.type === "REST").length ?? 0;
  const ftpCount = summary.effects?.filter((effect) => effect.type === "FTP").length ?? 0;
  const telnetCount = summary.effects?.filter((effect) => effect.type === "TELNET").length ?? 0;
  const errCount = summary.effects?.filter((effect) => effect.type === "ERROR").length ?? 0;
  const parts = [] as string[];
  if (restCount > 0) parts.push(`REST ${restCount}`);
  if (ftpCount > 0) parts.push(`FTP ${ftpCount}`);
  if (telnetCount > 0) parts.push(`TELNET ${telnetCount}`);
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
  return (
    summary.effects?.find((effect) => effect.type === "TELNET" || effect.type === "REST" || effect.type === "FTP") ??
    null
  );
};

const buildActionTitle = (summary: ActionSummary) => {
  const primary = getActionPrimaryEffect(summary);
  if (!primary) return summary.actionName;
  if (primary.type === "TELNET") {
    return primary.menuPath
      ? `${primary.actionLabel} · ${primary.menuPath[0]} → ${primary.menuPath[1]}`
      : primary.actionLabel;
  }
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
  } else if (primary?.type === "TELNET") {
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
  const telnetPort = getStoredTelnetPort();
  const deviceHost = snapshot.deviceHost.replace(/^https?:\/\//, "");

  try {
    const url = new URL(snapshot.baseUrl, window.location.origin);
    return {
      host: stripPortFromDeviceHost(deviceHost || url.hostname),
      httpPort: getDeviceHostHttpPort(deviceHost || url.hostname, snapshot.baseUrl),
      ftpPort,
      telnetPort,
    };
  } catch (error) {
    console.warn("Failed to parse diagnostics connection snapshot base URL", {
      baseUrl: snapshot.baseUrl,
      deviceHost: snapshot.deviceHost,
      error,
    });
    return {
      host: stripPortFromDeviceHost(deviceHost || "c64u"),
      httpPort: getDeviceHostHttpPort(deviceHost, snapshot.baseUrl),
      ftpPort,
      telnetPort,
    };
  }
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
  if (healthState.lastTelnetActivity) return healthState.lastTelnetActivity.timestampMs;
  return null;
};

const buildConnectionLabel = (deviceLabel: string, productCode: string) => {
  const normalizedDeviceLabel = deviceLabel.trim();
  const normalizedProductCode = productCode.trim();
  if (!normalizedDeviceLabel) return normalizedProductCode || "C64U";
  if (!normalizedProductCode) return normalizedDeviceLabel;
  if (normalizedDeviceLabel.localeCompare(normalizedProductCode, undefined, { sensitivity: "accent" }) === 0) {
    return normalizedDeviceLabel;
  }
  return `${normalizedDeviceLabel} · ${normalizedProductCode}`;
};

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

const buildDeviceDetailLines = (attribution: DiagnosticsDeviceAttribution | null, deviceLabel: string | null) => {
  if (!attribution) return [] as string[];
  const lines = [`Device: ${deviceLabel ?? attribution.savedDeviceNameSnapshot ?? "Unknown device"}`];
  if (attribution.savedDeviceId) {
    lines.push(`Saved device id: ${attribution.savedDeviceId}`);
  }
  const verifiedDeviceLabel = formatDiagnosticsVerifiedDeviceLabel(attribution);
  if (verifiedDeviceLabel) {
    lines.push(`Verified device: ${verifiedDeviceLabel}`);
  }
  return lines;
};

const getEntryExpandedDetail = (entry: EvidenceEntry): ReactNode | null => {
  const deviceLines = buildDeviceDetailLines(entry.device, entry.deviceLabel);

  if (entry.type === "Logs" || (entry.type === "Problems" && "level" in entry.payload)) {
    return [...deviceLines, formatLogExpandedDetail(entry.payload as LogEntry)].filter(Boolean).join("\n\n") || null;
  }

  if (entry.type === "Actions") {
    const summary = entry.payload as ActionSummary;
    return <ActionExpandedContent summary={summary} deviceLabel={entry.deviceLabel} />;
  }

  const trace = entry.payload as TraceEvent;
  return [
    ...deviceLines,
    formatJsonBlock({
      type: trace.type,
      origin: trace.origin,
      correlationId: trace.correlationId,
      data: trace.data,
    }),
  ]
    .filter(Boolean)
    .join("\n\n");
};

const EvidenceRow = ({
  entry,
  expanded,
  onToggle,
  showDeviceLabel,
}: {
  entry: EvidenceEntry;
  expanded: boolean;
  onToggle: () => void;
  showDeviceLabel: boolean;
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
              {showDeviceLabel && entry.deviceLabel ? <span>· {entry.deviceLabel}</span> : null}
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
  selectedTypes,
  onSelectedTypesChange,
  contributor,
  onContributorChange,
  severity,
  onSeverityChange,
  deviceFilter,
  onDeviceFilterChange,
  deviceOptions,
  showDeviceFilter,
  totalCount,
  visibleCount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedTypes: Set<EvidenceType>;
  onSelectedTypesChange: (value: Set<EvidenceType>) => void;
  contributor: ContributorFilter;
  onContributorChange: (value: ContributorFilter) => void;
  severity: SeverityFilter;
  onSeverityChange: (value: SeverityFilter) => void;
  deviceFilter: DeviceFilter;
  onDeviceFilterChange: (value: DeviceFilter) => void;
  deviceOptions: DeviceFilterOption[];
  showDeviceFilter: boolean;
  totalCount: number;
  visibleCount: number;
}) => {
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

  return (
    <AppSheet open={open} onOpenChange={onOpenChange}>
      <AppSheetContent
        className="z-[60] overflow-hidden p-0 sm:w-[min(100vw-2rem,22rem)]"
        data-testid="filters-editor-surface"
      >
        <AppSheetHeader>
          <AppSheetTitle className="text-base">Filters</AppSheetTitle>
          <AppSheetDescription className="sr-only">
            Filter diagnostics activity by type, contributor, and severity.
          </AppSheetDescription>
        </AppSheetHeader>
        <AppSheetBody className="px-4 py-3">
          <p className="mb-3 text-xs text-muted-foreground" data-testid="filters-result-count">
            {visibleCount} of {totalCount}
          </p>

          <div className="space-y-3">
            {showDeviceFilter ? (
              <section className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Device</p>
                <div className="flex flex-wrap gap-1.5">
                  <FilterToggleChip
                    label="All devices"
                    checked={deviceFilter === null}
                    onChange={(checked) => {
                      if (!checked) return;
                      onDeviceFilterChange(null);
                    }}
                  />
                  {deviceOptions.map((option) => (
                    <FilterToggleChip
                      key={option.id}
                      label={option.label}
                      checked={deviceFilter === option.id}
                      onChange={(checked) => {
                        if (!checked) return;
                        onDeviceFilterChange(option.id);
                      }}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            <section className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Activity types</p>
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
                {(["All", "App", "REST", "FTP", "TELNET"] as const).map((option) => (
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
                    onDeviceFilterChange(null);
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
                    onDeviceFilterChange(null);
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
                    onDeviceFilterChange(null);
                  }}
                  data-testid="quick-filter-reset"
                >
                  Reset
                </Button>
              </div>
            </section>
          </div>
        </AppSheetBody>
      </AppSheetContent>
    </AppSheet>
  );
};

const ConnectionSurface = ({
  open,
  onOpenChange,
  mode,
  displayName,
  draft,
  setDraft,
  onStartEdit,
  onSave,
  nameError,
  hostError,
  portError,
  productCode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "view" | "edit";
  displayName: string;
  draft: SavedDeviceEditorDraft;
  setDraft: (value: SavedDeviceEditorDraft) => void;
  onStartEdit: () => void;
  onSave: () => void;
  nameError: string | null;
  hostError: string | null;
  portError: string | null;
  productCode: string;
}) => {
  return (
    <AppDialog open={open} onOpenChange={onOpenChange}>
      <AppDialogContent data-testid={mode === "view" ? "connection-view-surface" : "connection-edit-surface"}>
        <AppDialogHeader>
          <AppDialogTitle>{mode === "view" ? "Connection details" : "Edit connection"}</AppDialogTitle>
          <AppDialogDescription>
            {mode === "view"
              ? "Review the current host and ports used for the connected device."
              : "Update the host and ports used for the connected device."}
          </AppDialogDescription>
        </AppDialogHeader>
        <AppDialogBody>
          {mode === "view" ? (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-[4rem_1fr] gap-y-2">
                <span className="text-muted-foreground">Name</span>
                <span className="font-medium text-foreground">{displayName}</span>
                <span className="text-muted-foreground">Type</span>
                <span className="font-medium text-foreground">{productCode}</span>
                <span className="text-muted-foreground">Host</span>
                <span className="font-medium text-foreground">{draft.host}</span>
                <span className="text-muted-foreground">HTTP</span>
                <span className="font-medium text-foreground">{draft.httpPort}</span>
                <span className="text-muted-foreground">FTP</span>
                <span className="font-medium text-foreground">{draft.ftpPort}</span>
                <span className="text-muted-foreground">Telnet</span>
                <span className="font-medium text-foreground">{draft.telnetPort}</span>
              </div>
              <Button type="button" onClick={onStartEdit} data-testid="connection-view-edit">
                Edit
              </Button>
            </div>
          ) : (
            <SavedDeviceEditorFields
              draft={draft}
              onChange={setDraft}
              nameError={nameError}
              hostError={hostError}
              portError={portError}
              idPrefix="connection-edit"
            />
          )}
        </AppDialogBody>
        {mode === "edit" ? (
          <AppDialogFooter>
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
          </AppDialogFooter>
        ) : null}
      </AppDialogContent>
    </AppDialog>
  );
};

const ConfigDriftSurface = ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => {
  return (
    <AppSheet open={open} onOpenChange={onOpenChange}>
      <AppSheetContent
        className="z-[62] overflow-hidden p-0 sm:w-[min(100vw-2rem,34rem)]"
        data-testid="config-drift-surface"
      >
        <AppSheetHeader>
          <AppSheetTitle className="text-base">Config Drift</AppSheetTitle>
          <AppSheetDescription className="sr-only">
            Review runtime configuration drift against persisted settings.
          </AppSheetDescription>
        </AppSheetHeader>
        <AppSheetBody className="px-4 py-3">
          <ConfigDriftView onBack={() => onOpenChange(false)} />
        </AppSheetBody>
      </AppSheetContent>
    </AppSheet>
  );
};

const DecisionStateSurface = ({
  open,
  onOpenChange,
  repairRunning,
  onRepair,
  actionSummaries,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repairRunning: boolean;
  onRepair?: () => void | Promise<void>;
  actionSummaries: ActionSummary[];
}) => {
  return (
    <AppSheet open={open} onOpenChange={onOpenChange}>
      <AppSheetContent
        className="z-[62] overflow-hidden p-0 sm:w-[min(100vw-2rem,42rem)]"
        data-testid="decision-state-surface"
      >
        <AppSheetHeader>
          <AppSheetTitle className="text-base">Decision state</AppSheetTitle>
          <AppSheetDescription className="sr-only">
            Internal reconciliation, playback uncertainty, and recent diagnostics transitions.
          </AppSheetDescription>
        </AppSheetHeader>
        <AppSheetBody className="px-4 py-3">
          <DecisionStateView
            onBack={() => onOpenChange(false)}
            onRepair={() => onRepair?.()}
            repairRunning={repairRunning}
            actionSummaries={actionSummaries}
          />
        </AppSheetBody>
      </AppSheetContent>
    </AppSheet>
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
  healthHistory,
  requestedPanel = null,
  repairRunning = false,
  onRepair,
}: Props) {
  const navigate = useNavigate();
  const { profile } = useDisplayProfile();
  const savedDevices = useSavedDevices();
  const [headerExpanded, setHeaderExpanded] = useState(false);
  const [expandedEvidenceId, setExpandedEvidenceId] = useState<string | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<Set<EvidenceType>>(defaultEvidenceTypes ?? DEFAULT_TYPES);
  const [contributor, setContributor] = useState<ContributorFilter>("All");
  const [severity, setSeverity] = useState<SeverityFilter>("All");
  const [deviceFilter, setDeviceFilter] = useState<DeviceFilter>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [connectionMode, setConnectionMode] = useState<"view" | "edit">("view");
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [connectionDraft, setConnectionDraft] = useState<SavedDeviceEditorDraft>(() =>
    buildSavedDeviceEditorDraft(null),
  );
  const [connectionNameError, setConnectionNameError] = useState<string | null>(null);
  const [connectionHostError, setConnectionHostError] = useState<string | null>(null);
  const [connectionPortError, setConnectionPortError] = useState<string | null>(null);
  const [latencyOpen, setLatencyOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [configDriftOpen, setConfigDriftOpen] = useState(false);
  const [decisionStateOpen, setDecisionStateOpen] = useState(false);
  const [heatMapVariant, setHeatMapVariant] = useState<HeatMapVariant | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressHandledRef = useRef(false);
  const selectedSavedDevice =
    savedDevices.devices.find((device) => device.id === savedDevices.selectedDeviceId) ??
    savedDevices.devices[0] ??
    null;
  const selectedProductCode = selectedSavedDevice?.lastKnownProduct ?? "C64U";
  const showDeviceUi = shouldShowDiagnosticsDeviceUi(savedDevices);

  const allEntries = useMemo(() => {
    const items: EvidenceEntry[] = [];
    const resolveEntryDeviceLabel = (device: DiagnosticsDeviceAttribution | null) => {
      if (!device) return null;
      return (
        resolveDiagnosticsDeviceLabel(device, savedDevices) ??
        (hasDiagnosticsDeviceAttribution(device) ? "Unknown device" : null)
      );
    };

    for (const entry of errorLogs) {
      const device = readDiagnosticsDeviceAttribution(entry.device);
      items.push({
        id: `problem-log-${entry.id}`,
        type: "Problems",
        title: formatLogHeadline(entry),
        detail: getLogSecondaryDetail(entry),
        contributor: "App",
        severity: resolveLogSeverity(entry.level),
        timestamp: entry.timestamp,
        device,
        deviceLabel: resolveEntryDeviceLabel(device),
        payload: entry,
      });
    }

    for (const entry of traceEvents) {
      if (!isTraceProblem(entry)) continue;
      const device = readDiagnosticsDeviceAttribution(entry.data?.device);
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
        device,
        deviceLabel: resolveEntryDeviceLabel(device),
        payload: entry,
      });
    }

    for (const summary of actionSummaries) {
      const device = summary.device ?? null;
      items.push({
        id: `action-${summary.correlationId}`,
        type: "Actions",
        title: buildActionTitle(summary),
        detail: buildActionDetail(summary),
        contributor: getActionContributor(summary),
        severity: resolveActionSeverity(summary.outcome),
        timestamp: summary.startTimestamp ?? summary.endTimestamp ?? new Date(0).toISOString(),
        device,
        deviceLabel: resolveEntryDeviceLabel(device),
        payload: summary,
      });
    }

    for (const entry of logs) {
      const device = readDiagnosticsDeviceAttribution(entry.device);
      items.push({
        id: `log-${entry.id}`,
        type: "Logs",
        title: formatLogHeadline(entry),
        detail: getLogSecondaryDetail(entry),
        contributor: "App",
        severity: resolveLogSeverity(entry.level),
        timestamp: entry.timestamp,
        device,
        deviceLabel: resolveEntryDeviceLabel(device),
        payload: entry,
      });
    }

    for (const entry of traceEvents) {
      const device = readDiagnosticsDeviceAttribution(entry.data?.device);
      items.push({
        id: `trace-${entry.id}`,
        type: "Traces",
        title: getTraceTitle(entry),
        detail: null,
        contributor: getTraceContributor(entry),
        severity: resolveTraceSeverity(entry),
        timestamp: entry.timestamp,
        device,
        deviceLabel: resolveEntryDeviceLabel(device),
        payload: entry,
      });
    }

    return items.sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
  }, [actionSummaries, errorLogs, logs, savedDevices, traceEvents]);

  const deviceFilterOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: DeviceFilterOption[] = [];
    allEntries.forEach((entry) => {
      const savedDeviceId = entry.device?.savedDeviceId ?? null;
      if (!savedDeviceId || seen.has(savedDeviceId)) return;
      seen.add(savedDeviceId);
      options.push({
        id: savedDeviceId,
        label: entry.deviceLabel ?? entry.device?.savedDeviceNameSnapshot ?? "Unknown device",
      });
    });
    return options.sort((left, right) => left.label.localeCompare(right.label));
  }, [allEntries]);
  const showDeviceFilter = showDeviceUi && deviceFilterOptions.length > 0;

  useEffect(() => {
    if (!open) return;
    setHeaderExpanded(false);
    setSelectedTypes(defaultEvidenceTypes ?? new Set(DEFAULT_TYPES));
    setContributor("All");
    setSeverity("All");
    setDeviceFilter(null);
    setFiltersOpen(false);
    setConnectionOpen(false);
    setConnectionMode("view");
    setConnectionNameError(null);
    setConnectionHostError(null);
    setConnectionPortError(null);
    setLatencyOpen(false);
    setHistoryOpen(false);
    setConfigDriftOpen(false);
    setDecisionStateOpen(false);
    setHeatMapVariant(null);
    setOverflowOpen(false);
    setExpandedEvidenceId(null);

    const snapshot = parseConnectionSnapshot();
    setConnectionDraft(
      selectedSavedDevice
        ? buildSavedDeviceEditorDraft(selectedSavedDevice, selectedSavedDevice.host)
        : buildSavedDeviceEditorDraft(
            {
              name: healthState.connectedDeviceLabel ?? snapshot.host,
              host: snapshot.host,
              httpPort: snapshot.httpPort,
              ftpPort: snapshot.ftpPort,
              telnetPort: snapshot.telnetPort,
            },
            snapshot.host,
          ),
    );
  }, [defaultEvidenceTypes, healthState.connectedDeviceLabel, open, selectedSavedDevice]);

  useEffect(() => {
    if (deviceFilter !== null && !deviceFilterOptions.some((option) => option.id === deviceFilter)) {
      setDeviceFilter(null);
    }
  }, [deviceFilter, deviceFilterOptions]);

  useEffect(() => {
    if (!open) {
      setFiltersOpen(false);
      setConnectionOpen(false);
      setLatencyOpen(false);
      setHistoryOpen(false);
      setConfigDriftOpen(false);
      setDecisionStateOpen(false);
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
    setDecisionStateOpen(requestedPanel === "decision-state");
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
        if (deviceFilter !== null && entry.device?.savedDeviceId !== deviceFilter) return false;
        return matchesSeverity(severity, entry.severity);
      }),
    [allEntries, contributor, deviceFilter, selectedTypes, severity],
  );

  const visibleCount = filteredEntries.length;
  const totalCount = allEntries.length;
  const displayEntries = filteredEntries.slice(0, 20);
  const lastCheckTimestamp = getLastCheckTimestamp(lastHealthCheckResult, healthState);
  const healthDetailAvailable =
    headerExpanded || healthCheckRunning || liveHealthCheckProbes !== null || lastHealthCheckResult !== null;
  const connectionDisplayName = selectedSavedDevice
    ? buildSavedDevicePrimaryLabel(selectedSavedDevice)
    : connectionDraft.name || healthState.connectedDeviceLabel || connectionDraft.host;
  const connectionLabel = buildConnectionLabel(
    selectedSavedDevice
      ? buildSavedDevicePrimaryLabel(selectedSavedDevice)
      : (healthState.connectedDeviceLabel ?? "C64U"),
    selectedProductCode,
  );
  const activeFilterLabels = useMemo(() => {
    const labels: string[] = [];
    if (severity !== "All") labels.push(severity);
    const selectedTypeLabels = EVIDENCE_ORDER.filter((type) => selectedTypes.has(type));
    if (selectedTypeLabels.length !== EVIDENCE_ORDER.length) {
      labels.push(...selectedTypeLabels);
    }
    if (contributor !== "All") labels.push(contributor);
    if (showDeviceFilter && deviceFilter !== null) {
      labels.push(deviceFilterOptions.find((option) => option.id === deviceFilter)?.label ?? "Unknown device");
    }
    return labels;
  }, [contributor, deviceFilter, deviceFilterOptions, selectedTypes, severity, showDeviceFilter]);

  const filterBarChips = activeFilterLabels.slice(0, 2);
  const overflowChipCount = Math.max(0, activeFilterLabels.length - 2);

  const openConnectionView = useCallback(() => {
    setConnectionMode("view");
    setConnectionNameError(null);
    setConnectionHostError(null);
    setConnectionPortError(null);
    setConnectionOpen(true);
  }, []);

  const openConnectionEdit = useCallback(() => {
    setConnectionMode("edit");
    setConnectionNameError(null);
    setConnectionHostError(null);
    setConnectionPortError(null);
    setConnectionOpen(true);
  }, []);

  const handleConnectionDraftChange = useCallback(
    (nextDraft: SavedDeviceEditorDraft) => {
      setConnectionDraft(nextDraft);
      if (selectedSavedDevice && connectionNameError) {
        setConnectionNameError(
          validateSavedDeviceName(savedDevices.devices, selectedSavedDevice.id, nextDraft.name, nextDraft.host),
        );
      }
      if (connectionHostError) {
        setConnectionHostError(validateDeviceHost(nextDraft.host));
      }
      if (connectionPortError) {
        setConnectionPortError(validateSavedDevicePorts(nextDraft));
      }
    },
    [connectionHostError, connectionNameError, connectionPortError, savedDevices.devices, selectedSavedDevice],
  );

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
    const hostError = validateDeviceHost(nextHost);
    const nameError = selectedSavedDevice
      ? validateSavedDeviceName(savedDevices.devices, selectedSavedDevice.id, connectionDraft.name, nextHost)
      : null;
    const portError = validateSavedDevicePorts(connectionDraft);

    setConnectionHostError(hostError);
    setConnectionNameError(nameError);
    setConnectionPortError(portError);
    if (hostError || nameError || portError) {
      return;
    }

    const password = getC64APIConfigSnapshot().password;
    const deviceHost = buildDeviceHostWithHttpPort(nextHost, Number(connectionDraft.httpPort));
    if (selectedSavedDevice) {
      updateSavedDevice(selectedSavedDevice.id, {
        name: connectionDraft.name,
        host: nextHost,
        httpPort: Number(connectionDraft.httpPort),
        ftpPort: Number(connectionDraft.ftpPort),
        telnetPort: Number(connectionDraft.telnetPort),
      });
    }
    updateC64APIConfig(buildBaseUrlFromDeviceHost(deviceHost), password, deviceHost);
    setStoredFtpPort(Number(connectionDraft.ftpPort));
    setStoredTelnetPort(Number(connectionDraft.telnetPort));
    setConnectionNameError(null);
    setConnectionHostError(null);
    setConnectionPortError(null);
    setConnectionOpen(false);
    onRetryConnection();
  };

  const handleShareFiltered = () => {
    void onShareFiltered(filteredEntries.map((entry) => entry.payload));
  };

  const handleManageDevices = useCallback(() => {
    onOpenChange(false);
    navigate("/settings");
  }, [navigate, onOpenChange]);

  const overflowPanelContent = (
    <>
      <p className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Views</p>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs whitespace-normal hover:bg-muted"
        onClick={() => {
          setOverflowOpen(false);
          openConnectionView();
        }}
        data-testid="diagnostics-connection-details-action"
      >
        Connection details
      </button>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs whitespace-normal hover:bg-muted"
        onClick={() => {
          setOverflowOpen(false);
          handleManageDevices();
        }}
        data-testid="diagnostics-manage-devices-action"
      >
        Manage devices
      </button>
      <div className="my-1 border-t border-border" />
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs whitespace-normal hover:bg-muted"
        onClick={() => {
          setOverflowOpen(false);
          setConfigDriftOpen(true);
        }}
        data-testid="open-config-drift-screen"
      >
        Config drift
      </button>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs whitespace-normal hover:bg-muted"
        onClick={() => {
          setOverflowOpen(false);
          setDecisionStateOpen(true);
        }}
        data-testid="open-decision-state-screen"
      >
        Decision state
      </button>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs whitespace-normal hover:bg-muted"
        onClick={() => {
          setOverflowOpen(false);
          setLatencyOpen(true);
        }}
        data-testid="open-latency-screen"
      >
        Latency
      </button>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs whitespace-normal hover:bg-muted"
        onClick={() => {
          setOverflowOpen(false);
          setHistoryOpen(true);
        }}
        data-testid="open-timeline-screen"
      >
        Health history
      </button>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs whitespace-normal hover:bg-muted"
        onClick={() => {
          setOverflowOpen(false);
          setHeatMapVariant("REST");
        }}
        data-testid="open-rest-heatmap-screen"
      >
        REST heat map
      </button>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs whitespace-normal hover:bg-muted"
        onClick={() => {
          setOverflowOpen(false);
          setHeatMapVariant("FTP");
        }}
        data-testid="open-ftp-heatmap-screen"
      >
        FTP heat map
      </button>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs whitespace-normal hover:bg-muted"
        onClick={() => {
          setOverflowOpen(false);
          setHeatMapVariant("CONFIG");
        }}
        data-testid="open-config-heatmap-screen"
      >
        Config heat map
      </button>
      <div
        className={cn(
          profile === "compact" &&
            "sticky bottom-0 mt-1 border-t border-border bg-background/95 py-1 backdrop-blur supports-[backdrop-filter]:bg-background/80",
        )}
      >
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs whitespace-normal hover:bg-muted"
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
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs whitespace-normal hover:bg-muted"
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
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-destructive whitespace-normal hover:bg-muted"
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
    </>
  );

  const overflowPanel =
    overflowOpen && profile === "compact" ? (
      <div
        className="fixed inset-x-4 top-[5.25rem] z-[220] max-h-[min(16rem,calc(100dvh-7rem))] overflow-y-auto overscroll-contain rounded-lg border border-border bg-background py-1 shadow-lg"
        data-testid="diagnostics-overflow-panel"
      >
        {overflowPanelContent}
      </div>
    ) : overflowOpen ? (
      <div
        className="absolute right-0 top-full z-10 mt-1 w-max max-w-[min(13rem,calc(100vw-2rem))] rounded-lg border border-border bg-background py-1 shadow-lg"
        data-testid="diagnostics-overflow-panel"
      >
        {overflowPanelContent}
      </div>
    ) : null;

  return (
    <>
      <AppSheet open={open} onOpenChange={onOpenChange}>
        <AppSheetContent className="flex min-h-0 flex-col overflow-hidden" data-testid="diagnostics-sheet">
          <AppSheetHeader
            actions={
              <div className="relative z-10">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 opacity-70"
                  onClick={() => setOverflowOpen((v) => !v)}
                  data-testid="diagnostics-overflow-menu"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
                {overflowPanel}
              </div>
            }
          >
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
                    disabled={!onRunHealthCheck}
                    data-testid="run-health-check"
                  >
                    {healthCheckRunning ? "Restart health check" : "Run health check"}
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
                  />
                </div>
              ) : null}
            </section>

            {/* Phase 3: Unified filter bar */}
            <div
              className="mt-3 flex items-center gap-1.5 overflow-hidden rounded-full border border-border/70 bg-card px-2.5 py-1.5 text-xs"
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

            {/* Phase 2: Evidence list (immediately visible) */}
            <section className="mt-2 min-h-0 flex-1" data-testid="evidence-panel">
              <p className="mb-1 text-xs font-semibold text-foreground" data-testid="evidence-heading">
                Activity
              </p>
              <p className="mb-2 text-[10px] text-muted-foreground" data-testid="activity-kinds-line">
                Problems, actions, logs, and traces across App, REST, FTP, and Telnet
              </p>
              <div className="max-h-72 space-y-1.5 overflow-y-auto" data-testid="evidence-list">
                {displayEntries.map((entry) => (
                  <Fragment key={entry.id}>
                    <EvidenceRow
                      entry={entry}
                      expanded={expandedEvidenceId === entry.id}
                      onToggle={() => setExpandedEvidenceId((current) => (current === entry.id ? null : entry.id))}
                      showDeviceLabel={showDeviceUi}
                    />
                  </Fragment>
                ))}
                {displayEntries.length === 0 ? (
                  <p className="py-2 text-xs text-muted-foreground">No matching activity.</p>
                ) : null}
              </div>
            </section>
          </div>
        </AppSheetContent>
      </AppSheet>

      <FilterEditorSurface
        open={open && filtersOpen}
        onOpenChange={setFiltersOpen}
        selectedTypes={selectedTypes}
        onSelectedTypesChange={setSelectedTypes}
        contributor={contributor}
        onContributorChange={setContributor}
        severity={severity}
        onSeverityChange={setSeverity}
        deviceFilter={deviceFilter}
        onDeviceFilterChange={setDeviceFilter}
        deviceOptions={deviceFilterOptions}
        showDeviceFilter={showDeviceFilter}
        totalCount={totalCount}
        visibleCount={visibleCount}
      />

      <ConnectionSurface
        open={open && connectionOpen}
        onOpenChange={setConnectionOpen}
        mode={connectionMode}
        displayName={connectionDisplayName}
        draft={connectionDraft}
        setDraft={handleConnectionDraftChange}
        onStartEdit={() => setConnectionMode("edit")}
        onSave={saveConnection}
        nameError={connectionNameError}
        hostError={connectionHostError}
        portError={connectionPortError}
        productCode={selectedProductCode}
      />

      <ConfigDriftSurface open={open && configDriftOpen} onOpenChange={setConfigDriftOpen} />
      <DecisionStateSurface
        open={open && decisionStateOpen}
        onOpenChange={setDecisionStateOpen}
        repairRunning={repairRunning}
        onRepair={onRepair}
        actionSummaries={actionSummaries}
      />
      {open && latencyOpen ? <LatencyAnalysisPopup open onClose={() => setLatencyOpen(false)} /> : null}
      {open && historyOpen ? (
        <HealthHistoryPopup open onClose={() => setHistoryOpen(false)} history={healthHistory} />
      ) : null}
      <HeatMapPopup
        open={open && heatMapVariant !== null}
        onClose={() => setHeatMapVariant(null)}
        variant={heatMapVariant ?? "REST"}
        traceEvents={traceEvents}
      />
    </>
  );
}
