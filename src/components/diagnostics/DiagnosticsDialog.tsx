/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronDown, ChevronRight, Filter, Share2, Trash2 } from "lucide-react";

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
import {
    resolveActionSeverity,
    resolveLogSeverity,
    resolveTraceSeverity,
    type DiagnosticsSeverity,
} from "@/lib/diagnostics/diagnosticsSeverity";
import { HEALTH_GLYPHS, type ContributorKey, type OverallHealthState } from "@/lib/diagnostics/healthModel";
import { formatDiagnosticsTimestamp } from "@/lib/diagnostics/timeFormat";
import type { LogEntry } from "@/lib/logging";
import { getTraceTitle } from "@/lib/tracing/traceFormatter";
import type { TraceEvent } from "@/lib/tracing/types";
import { cn } from "@/lib/utils";
import type { DeviceDetailInfo } from "@/components/diagnostics/DeviceDetailView";
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

const severityLabel = (value: DiagnosticsSeverity) => {
    if (value === "error") return "Errors";
    if (value === "warn") return "Warnings";
    return "Info";
};

const severityGlyph = (value: DiagnosticsSeverity) => {
    if (value === "error") return "ERR";
    if (value === "warn") return "WARN";
    return "INFO";
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

const pluralize = (count: number, label: string) => `${count} ${label}${count === 1 ? "" : "s"}`;

const countLabel = (visibleCount: number, totalCount: number) => {
    if (visibleCount === totalCount) return `${totalCount}`;
    return `${visibleCount} of ${totalCount}`;
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
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            Close
        </Button>
    </div>
);

const FilterChip = ({ label }: { label: string }) => (
    <span className="rounded-full border border-border/70 bg-background px-2 py-0.5 text-[11px] font-medium leading-5">
        {label}
    </span>
);

const FilterToggle = ({
    label,
    checked,
    onChange,
}: {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
}) => (
    <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4" />
        <span>{label}</span>
    </label>
);

const EvidenceRow = ({ entry }: { entry: EvidenceEntry }) => (
    <div
        className="rounded-xl border border-border/70 bg-background px-3 py-2.5"
        data-testid={`evidence-row-${entry.id}`}
    >
        <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{entry.title}</p>
                {entry.detail ? <p className="truncate text-xs text-muted-foreground">{entry.detail}</p> : null}
            </div>
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {severityGlyph(entry.severity)}
            </span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{entry.type}</span>
            {entry.contributor ? <span>· {entry.contributor}</span> : null}
            <span>· {formatDiagnosticsTimestamp(entry.timestamp)}</span>
        </div>
    </div>
);

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
        ? "fixed bottom-4 right-4 top-4 z-[60] flex w-[24rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-[28px] border bg-background shadow-2xl"
        : "fixed inset-x-0 bottom-0 top-[12dvh] z-[60] flex flex-col overflow-hidden rounded-t-[28px] border border-b-0 bg-background shadow-2xl";

    return (
        <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="fixed inset-0 z-[59] bg-black/70" />
                <DialogPrimitive.Content className={contentClassName} data-testid="filters-editor-surface">
                    <DialogPrimitive.Title className="sr-only">Diagnostics filters</DialogPrimitive.Title>
                    <DialogPrimitive.Description className="sr-only">
                        Filter diagnostics evidence by type, contributor, and severity.
                    </DialogPrimitive.Description>
                    <SurfaceHeader title="Filters" onClose={() => onOpenChange(false)} />
                    <div className="flex-1 overflow-y-auto px-4 py-4">
                        <div className="space-y-5">
                            <section className="space-y-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Type</p>
                                {EVIDENCE_ORDER.map((type) => (
                                    <FilterToggle
                                        key={type}
                                        label={type}
                                        checked={selectedTypes.has(type)}
                                        onChange={(checked) => toggleType(type, checked)}
                                    />
                                ))}
                            </section>

                            <section className="space-y-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contributor</p>
                                {(["All", "App", "REST", "FTP"] as const).map((option) => (
                                    <FilterToggle
                                        key={option}
                                        label={option}
                                        checked={contributor === option}
                                        onChange={(checked) => {
                                            if (!checked) return;
                                            onContributorChange(option);
                                        }}
                                    />
                                ))}
                            </section>

                            <section className="space-y-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Severity</p>
                                {(["All", "Errors", "Warnings", "Info"] as const).map((option) => (
                                    <FilterToggle
                                        key={option}
                                        label={option}
                                        checked={severity === option}
                                        onChange={(checked) => {
                                            if (!checked) return;
                                            onSeverityChange(option);
                                        }}
                                    />
                                ))}
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
                        <div className="space-y-4 px-4 py-4 text-sm">
                            <div className="grid grid-cols-[4rem_1fr] gap-y-3">
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
                        <div className="space-y-4 px-4 py-4 text-sm">
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
                                    onChange={(event) => setDraft({ ...draft, httpPort: event.target.value.replace(/[^0-9]/g, "") })}
                                    data-testid="connection-edit-http"
                                />
                            </label>
                            <label className="block space-y-1">
                                <span className="text-muted-foreground">FTP</span>
                                <Input
                                    value={draft.ftpPort}
                                    inputMode="numeric"
                                    onChange={(event) => setDraft({ ...draft, ftpPort: event.target.value.replace(/[^0-9]/g, "") })}
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
}: Props) {
    const { profile } = useDisplayProfile();
    const [headerExpanded, setHeaderExpanded] = useState(false);
    const [selectedTypes, setSelectedTypes] = useState<Set<EvidenceType>>(defaultEvidenceTypes ?? DEFAULT_TYPES);
    const [contributor, setContributor] = useState<ContributorFilter>("All");
    const [severity, setSeverity] = useState<SeverityFilter>("All");
    const [activeTab, setActiveTab] = useState<EvidenceType>("Problems");
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
    const longPressTimerRef = useRef<number | null>(null);
    const longPressHandledRef = useRef(false);

    const allEntries = useMemo(() => {
        const items: EvidenceEntry[] = [];

        for (const entry of errorLogs) {
            items.push({
                id: `problem-log-${entry.id}`,
                type: "Problems",
                title: entry.message,
                detail: entry.details ? JSON.stringify(entry.details) : null,
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
                title: summary.actionName,
                detail: summarizeAction(summary),
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
                title: entry.message,
                detail: entry.details ? JSON.stringify(entry.details) : null,
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
        setHeaderExpanded(allEntries.length === 0);
        setSelectedTypes(defaultEvidenceTypes ?? new Set(DEFAULT_TYPES));
        setContributor("All");
        setSeverity("All");
        setFiltersOpen(false);
        setConnectionOpen(false);
        setConnectionMode("view");
        setConnectionError(null);
        setLatencyOpen(false);
        setHistoryOpen(false);

        const snapshot = parseConnectionSnapshot();
        setConnectionDraft({
            host: snapshot.host,
            httpPort: String(snapshot.httpPort),
            ftpPort: String(snapshot.ftpPort),
        });
    }, [allEntries.length, defaultEvidenceTypes, open]);

    useEffect(() => {
        if (!open) {
            setFiltersOpen(false);
            setConnectionOpen(false);
            setLatencyOpen(false);
            setHistoryOpen(false);
        }
    }, [open]);

    const filteredEntries = useMemo(
        () =>
            allEntries.filter((entry) => {
                if (!selectedTypes.has(entry.type)) return false;
                if (contributor !== "All" && entry.contributor !== contributor) return false;
                return matchesSeverity(severity, entry.severity);
            }),
        [allEntries, contributor, selectedTypes, severity],
    );

    const filteredCountsByType = useMemo(
        () =>
            EVIDENCE_ORDER.reduce(
                (accumulator, type) => ({
                    ...accumulator,
                    [type]: filteredEntries.filter((entry) => entry.type === type).length,
                }),
                {} as Record<EvidenceType, number>,
            ),
        [filteredEntries],
    );

    useEffect(() => {
        if (!selectedTypes.has(activeTab)) {
            const next = EVIDENCE_ORDER.find((type) => selectedTypes.has(type)) ?? "Problems";
            setActiveTab(next);
            return;
        }
        if (filteredCountsByType[activeTab] > 0) return;
        const next = EVIDENCE_ORDER.find((type) => selectedTypes.has(type) && filteredCountsByType[type] > 0);
        if (next) {
            setActiveTab(next);
        }
    }, [activeTab, filteredCountsByType, selectedTypes]);

    const tabEntries = useMemo(
        () => filteredEntries.filter((entry) => entry.type === activeTab).slice(0, 4),
        [activeTab, filteredEntries],
    );

    const visibleCount = filteredEntries.length;
    const totalCount = allEntries.length;
    const lastCheckTimestamp = getLastCheckTimestamp(lastHealthCheckResult, healthState);
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
    const sectionHeading = (() => {
        const count = filteredCountsByType[activeTab];
        if (activeTab === "Problems") return pluralize(count, "problem");
        if (activeTab === "Actions") return pluralize(count, "action");
        if (activeTab === "Logs") return pluralize(count, "log");
        return pluralize(count, "trace");
    })();

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
                    <AppSheetHeader className="space-y-0 px-4 pb-3 pt-4">
                        <AppSheetTitle>Diagnostics</AppSheetTitle>
                        <AppSheetDescription className="sr-only">
                            Review diagnostic evidence, connection details, latency, and health history.
                        </AppSheetDescription>
                    </AppSheetHeader>

                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4">
                        <section className="shrink-0 rounded-2xl border border-border/70 bg-card" data-testid="diagnostics-header">
                            <div className="flex items-start justify-between gap-3 px-4 py-3">
                                <div className="min-w-0 flex-1 space-y-1">
                                    <p
                                        className={cn("text-sm font-semibold", HEADER_TONE[healthState.state])}
                                        data-testid="diagnostics-health-line"
                                    >
                                        {HEALTH_GLYPHS[healthState.state]} {healthState.state}
                                    </p>
                                    <button
                                        type="button"
                                        className="block truncate text-left text-sm font-medium text-foreground underline-offset-2 hover:underline"
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
                                    <p className="text-sm text-muted-foreground" data-testid="diagnostics-last-check-line">
                                        {formatRelativeTime(lastCheckTimestamp)}
                                    </p>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={onRunHealthCheck}
                                        disabled={!onRunHealthCheck || healthCheckRunning}
                                        data-testid="run-health-check"
                                    >
                                        {healthCheckRunning ? "Running health check" : "Run health check"}
                                    </Button>
                                </div>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setHeaderExpanded((value) => !value)}
                                    data-testid="diagnostics-header-toggle"
                                    aria-expanded={headerExpanded}
                                >
                                    {headerExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                </Button>
                            </div>
                            {headerExpanded && lastHealthCheckResult ? (
                                <div className="border-t border-border/70 px-4 py-3" data-testid="diagnostics-header-expanded">
                                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                        <span>P50 {lastHealthCheckResult.latency.p50}ms</span>
                                        <span>· P90 {lastHealthCheckResult.latency.p90}ms</span>
                                        <span>· P99 {lastHealthCheckResult.latency.p99}ms</span>
                                    </div>
                                </div>
                            ) : null}
                        </section>

                        <section
                            className="mt-3 min-h-0 shrink-0 rounded-2xl border border-border/70 bg-card px-4 py-3"
                            data-testid="evidence-panel"
                        >
                            <div className="flex items-center gap-2 overflow-hidden whitespace-nowrap" data-testid="evidence-tabs">
                                {EVIDENCE_ORDER.map((type) => {
                                    const enabled = selectedTypes.has(type);
                                    return (
                                        <button
                                            key={type}
                                            type="button"
                                            onClick={() => {
                                                if (!enabled) return;
                                                setActiveTab(type);
                                            }}
                                            className={cn(
                                                "shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium",
                                                activeTab === type && enabled
                                                    ? "border-primary bg-primary/10 text-primary"
                                                    : "border-border text-muted-foreground",
                                                !enabled && "opacity-45",
                                            )}
                                            data-testid={`evidence-tab-${type.toLowerCase()}`}
                                        >
                                            {type}
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="mt-3 flex items-center justify-between gap-3">
                                <p className="text-sm font-semibold text-foreground" data-testid="evidence-heading">
                                    {sectionHeading}
                                </p>
                                <p className="text-xs text-muted-foreground" data-testid="evidence-count-label">
                                    {countLabel(visibleCount, totalCount)}
                                </p>
                            </div>

                            <div className="mt-3 max-h-64 space-y-2 overflow-y-auto" data-testid="evidence-list">
                                {tabEntries.map((entry) => (
                                    <EvidenceRow key={entry.id} entry={entry} />
                                ))}
                            </div>
                        </section>

                        <section className="mt-3 space-y-3" data-testid="diagnostics-controls">
                            <div
                                className="flex items-center gap-2 overflow-hidden rounded-full border border-border/70 bg-card px-3 py-2 text-xs"
                                data-testid="filters-collapsed-bar"
                            >
                                <span className="shrink-0 font-semibold text-foreground">Filters</span>
                                <span className="shrink-0 text-muted-foreground">·</span>
                                <span className="shrink-0 text-muted-foreground" data-testid="filters-result-count">
                                    {countLabel(visibleCount, totalCount)}
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
                                    className="h-7 w-7 p-0"
                                    onClick={() => setFiltersOpen(true)}
                                    data-testid="open-filters-editor"
                                >
                                    <Filter className="h-4 w-4" />
                                </Button>
                            </div>

                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setLatencyOpen(true)}
                                    data-testid="open-latency-screen"
                                >
                                    Latency
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setHistoryOpen(true)}
                                    data-testid="open-timeline-screen"
                                >
                                    Health history
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void onShareAll()}
                                    data-testid="diagnostics-share-all"
                                >
                                    <Share2 className="mr-1.5 h-3.5 w-3.5" />
                                    Share all
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={handleShareFiltered}
                                    data-testid="diagnostics-share-filtered"
                                >
                                    <Share2 className="mr-1.5 h-3.5 w-3.5" />
                                    Share filtered
                                </Button>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button type="button" variant="outline" size="sm" data-testid="diagnostics-clear-all-trigger">
                                            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                                            Clear all
                                        </Button>
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

            <LatencyAnalysisPopup open={open && latencyOpen} onClose={() => setLatencyOpen(false)} />
            <HealthHistoryPopup open={open && historyOpen} onClose={() => setHistoryOpen(false)} />
        </>
    );
}
