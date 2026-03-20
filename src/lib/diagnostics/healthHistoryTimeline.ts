import type { HealthHistoryEntry } from "@/lib/diagnostics/healthHistory";
import type { HealthState } from "@/lib/diagnostics/healthModel";

export const HEALTH_TIMELINE_DEFAULT_WINDOW_MS = 4 * 60 * 60 * 1000;

export const HEALTH_TIMELINE_ZOOM_WINDOWS = [
    15 * 60 * 1000,
    30 * 60 * 1000,
    60 * 60 * 1000,
    2 * 60 * 60 * 1000,
    4 * 60 * 60 * 1000,
] as const;

export const HEALTH_TIMELINE_STATE_COLORS: Record<HealthState, string> = {
    Healthy: "#16a34a",
    Degraded: "#f59e0b",
    Unhealthy: "#dc2626",
    Idle: "#d1d5db",
    Unavailable: "#4b5563",
};

export const HEALTH_TIMELINE_LEGEND_STATES: readonly HealthState[] = [
    "Healthy",
    "Degraded",
    "Unhealthy",
    "Idle",
    "Unavailable",
];

const HEALTH_STATE_SEVERITY: Record<HealthState, number> = {
    Unavailable: 0,
    Idle: 1,
    Healthy: 2,
    Degraded: 3,
    Unhealthy: 4,
};

type HealthHistoryEntryWithMs = HealthHistoryEntry & { timestampMs: number };

export type HealthTimelineSubsystem = "REST" | "FTP" | "App" | null;

export type HealthTimelineEvent = {
    id: string;
    timestampMs: number;
    state: HealthState;
    durationMs: number;
    rootCause: string;
    subsystem: HealthTimelineSubsystem;
    errorMessage: string | null;
    entry: HealthHistoryEntry;
};

export type HealthTimelineSourceSegment = {
    id: string;
    startMs: number;
    endMs: number;
    state: HealthState;
    events: HealthTimelineEvent[];
    synthetic: boolean;
};

export type HealthTimelineColumn = {
    index: number;
    startMs: number;
    endMs: number;
    displayState: HealthState;
    worstState: HealthState;
    sourceSegments: HealthTimelineSourceSegment[];
    eventCount: number;
    reservedSegmentId: string | null;
};

export type HealthTimelineSelection =
    | {
        kind: "segment";
        startMs: number;
        endMs: number;
        state: HealthState;
        eventCount: number;
        sourceSegments: HealthTimelineSourceSegment[];
        events: HealthTimelineEvent[];
    }
    | {
        kind: "aggregated";
        startMs: number;
        endMs: number;
        state: HealthState;
        worstState: HealthState;
        eventCount: number;
        sourceSegments: HealthTimelineSourceSegment[];
        events: HealthTimelineEvent[];
    };

export type HealthTimelineDisplaySegment = {
    id: string;
    startColumn: number;
    endColumn: number;
    startMs: number;
    endMs: number;
    state: HealthState;
    selection: HealthTimelineSelection;
};

export type HealthTimelineModel = {
    windowStartMs: number;
    windowEndMs: number;
    durationMs: number;
    sourceSegments: HealthTimelineSourceSegment[];
};

const severityOf = (state: HealthState): number => HEALTH_STATE_SEVERITY[state];

const sortHistoryEntries = (history: Readonly<HealthHistoryEntry[]>): HealthHistoryEntryWithMs[] => {
    const sorted = history
        .map((entry) => ({ ...entry, timestampMs: Date.parse(entry.timestamp) }))
        .filter((entry) => Number.isFinite(entry.timestampMs))
        .sort((left, right) => left.timestampMs - right.timestampMs);

    const deduped: HealthHistoryEntryWithMs[] = [];
    for (const entry of sorted) {
        const previous = deduped[deduped.length - 1];
        if (previous && previous.timestampMs === entry.timestampMs) {
            deduped[deduped.length - 1] = entry;
            continue;
        }
        deduped.push(entry);
    }
    return deduped;
};

const getEventSummary = (
    entry: HealthHistoryEntry,
): Pick<HealthTimelineEvent, "rootCause" | "subsystem" | "errorMessage"> => {
    const checks = [
        { subsystem: "REST" as const, probe: "REST", result: entry.probes.rest },
        { subsystem: "FTP" as const, probe: "FTP", result: entry.probes.ftp },
        { subsystem: "App" as const, probe: "CONFIG", result: entry.probes.config },
        { subsystem: "App" as const, probe: "JIFFY", result: entry.probes.jiffy },
        { subsystem: "App" as const, probe: "RASTER", result: entry.probes.raster },
    ];

    const failed = checks.find((check) => check.result.outcome === "Fail");
    if (failed) {
        const errorMessage = failed.result.reason ?? `${failed.probe} failed`;
        return {
            rootCause: errorMessage,
            subsystem: failed.subsystem,
            errorMessage,
        };
    }

    const partial = checks.find((check) => check.result.outcome === "Partial");
    if (partial) {
        const errorMessage = partial.result.reason ?? `${partial.probe} degraded`;
        return {
            rootCause: errorMessage,
            subsystem: partial.subsystem,
            errorMessage,
        };
    }

    if (entry.overallHealth === "Unavailable") {
        return {
            rootCause: "Device unavailable during this health check",
            subsystem: "App",
            errorMessage: null,
        };
    }

    if (entry.overallHealth === "Idle") {
        return {
            rootCause: "No active health issues recorded",
            subsystem: null,
            errorMessage: null,
        };
    }

    return {
        rootCause: "All probes passed",
        subsystem: null,
        errorMessage: null,
    };
};

const toTimelineEvent = (entry: HealthHistoryEntryWithMs, index: number): HealthTimelineEvent => {
    const summary = getEventSummary(entry);
    return {
        id: `event-${String(index).padStart(4, "0")}-${entry.timestampMs}`,
        timestampMs: entry.timestampMs,
        state: entry.overallHealth,
        durationMs: entry.durationMs,
        rootCause: summary.rootCause,
        subsystem: summary.subsystem,
        errorMessage: summary.errorMessage,
        entry,
    };
};

const mergeAdjacentSourceSegments = (segments: HealthTimelineSourceSegment[]): HealthTimelineSourceSegment[] => {
    const merged: HealthTimelineSourceSegment[] = [];

    for (const segment of segments) {
        if (segment.endMs <= segment.startMs) {
            continue;
        }

        const previous = merged[merged.length - 1];
        if (previous && previous.state === segment.state && previous.endMs === segment.startMs) {
            previous.endMs = segment.endMs;
            previous.events.push(...segment.events);
            previous.synthetic = previous.synthetic && segment.synthetic;
            previous.id = `segment-${previous.startMs}-${previous.endMs}-${previous.state}`;
            continue;
        }

        merged.push({ ...segment });
    }

    return merged;
};

export const buildHealthTimelineModel = (
    history: Readonly<HealthHistoryEntry[]>,
    options?: {
        nowMs?: number;
        windowDurationMs?: number;
        windowEndMs?: number;
    },
): HealthTimelineModel => {
    const sorted = sortHistoryEntries(history);
    const nowMs = options?.nowMs ?? Date.now();
    const lastTimestampMs = sorted[sorted.length - 1]?.timestampMs ?? nowMs;
    const windowEndMs = options?.windowEndMs ?? Math.max(nowMs, lastTimestampMs);
    const windowDurationMs = options?.windowDurationMs ?? HEALTH_TIMELINE_DEFAULT_WINDOW_MS;
    const windowStartMs = windowEndMs - windowDurationMs;

    if (sorted.length === 0) {
        return {
            windowStartMs,
            windowEndMs,
            durationMs: windowDurationMs,
            sourceSegments: [],
        };
    }

    const sourceSegments: HealthTimelineSourceSegment[] = [];
    const priorIndex = [...sorted].reverse().findIndex((entry) => entry.timestampMs <= windowStartMs);
    const carryEntry = priorIndex === -1 ? null : sorted[sorted.length - 1 - priorIndex];
    let currentState: HealthState = carryEntry?.overallHealth ?? "Idle";
    let currentEvents: HealthTimelineEvent[] = carryEntry
        ? [toTimelineEvent(carryEntry, sorted.indexOf(carryEntry))]
        : [];
    let currentSynthetic = carryEntry == null;
    let currentStartMs = windowStartMs;

    sorted.forEach((entry, index) => {
        if (entry.timestampMs <= windowStartMs || entry.timestampMs >= windowEndMs) {
            return;
        }

        if (entry.timestampMs > currentStartMs) {
            sourceSegments.push({
                id: `segment-${currentStartMs}-${entry.timestampMs}-${currentState}`,
                startMs: currentStartMs,
                endMs: entry.timestampMs,
                state: currentState,
                events: [...currentEvents],
                synthetic: currentSynthetic,
            });
        }

        currentState = entry.overallHealth;
        currentEvents = [toTimelineEvent(entry, index)];
        currentSynthetic = false;
        currentStartMs = entry.timestampMs;
    });

    if (currentStartMs < windowEndMs) {
        sourceSegments.push({
            id: `segment-${currentStartMs}-${windowEndMs}-${currentState}`,
            startMs: currentStartMs,
            endMs: windowEndMs,
            state: currentState,
            events: [...currentEvents],
            synthetic: currentSynthetic,
        });
    }

    return {
        windowStartMs,
        windowEndMs,
        durationMs: windowDurationMs,
        sourceSegments: mergeAdjacentSourceSegments(sourceSegments),
    };
};

const getOverlappingSegments = (
    sourceSegments: HealthTimelineSourceSegment[],
    startMs: number,
    endMs: number,
): HealthTimelineSourceSegment[] =>
    sourceSegments.filter((segment) => segment.endMs > startMs && segment.startMs < endMs);

const uniqueEventsForSegments = (segments: HealthTimelineSourceSegment[]): HealthTimelineEvent[] => {
    const seen = new Set<string>();
    const events: HealthTimelineEvent[] = [];

    for (const segment of segments) {
        for (const event of segment.events) {
            if (seen.has(event.id)) {
                continue;
            }
            seen.add(event.id);
            events.push(event);
        }
    }

    return events.sort((left, right) => left.timestampMs - right.timestampMs);
};

const worstStateForSegments = (segments: HealthTimelineSourceSegment[]): HealthState => {
    let worst = segments[0]?.state ?? "Idle";
    for (const segment of segments) {
        if (severityOf(segment.state) > severityOf(worst)) {
            worst = segment.state;
        }
    }
    return worst;
};

const assignReservedColumns = (model: HealthTimelineModel, widthPx: number): Map<string, number> => {
    const highSeveritySegments = model.sourceSegments.filter(
        (segment) => segment.state === "Unhealthy" || segment.state === "Degraded",
    );

    const assignments = new Map<string, number>();
    if (highSeveritySegments.length === 0 || widthPx <= 0 || model.durationMs <= 0) {
        return assignments;
    }

    highSeveritySegments.forEach((segment, index) => {
        const centerRatio = ((segment.startMs + segment.endMs) / 2 - model.windowStartMs) / model.durationMs;
        const preferred = Math.round(centerRatio * (widthPx - 1));
        const minAllowed = index === 0 ? 0 : (assignments.get(highSeveritySegments[index - 1]!.id) ?? -1) + 1;
        const maxAllowed = widthPx - 1 - (highSeveritySegments.length - index - 1);
        const boundedPreferred = Math.max(0, Math.min(widthPx - 1, preferred));
        const chosen =
            minAllowed > maxAllowed
                ? Math.max(0, Math.min(widthPx - 1, maxAllowed))
                : Math.max(minAllowed, Math.min(maxAllowed, boundedPreferred));
        assignments.set(segment.id, chosen);
    });

    return assignments;
};

const buildSelectionForColumn = (
    column: HealthTimelineColumn,
    sourceSegmentsById: Map<string, HealthTimelineSourceSegment>,
): HealthTimelineSelection => {
    if (column.reservedSegmentId) {
        const reserved = sourceSegmentsById.get(column.reservedSegmentId);
        if (reserved) {
            const events = uniqueEventsForSegments([reserved]);
            return {
                kind: "segment",
                startMs: reserved.startMs,
                endMs: reserved.endMs,
                state: reserved.state,
                eventCount: events.length,
                sourceSegments: [reserved],
                events,
            };
        }
    }

    if (column.sourceSegments.length === 1) {
        const segment = column.sourceSegments[0]!;
        const events = uniqueEventsForSegments([segment]);
        return {
            kind: "segment",
            startMs: segment.startMs,
            endMs: segment.endMs,
            state: segment.state,
            eventCount: events.length,
            sourceSegments: [segment],
            events,
        };
    }

    const events = uniqueEventsForSegments(column.sourceSegments);
    return {
        kind: "aggregated",
        startMs: column.startMs,
        endMs: column.endMs,
        state: column.displayState,
        worstState: column.worstState,
        eventCount: events.length,
        sourceSegments: [...column.sourceSegments],
        events,
    };
};

export const buildRenderedHealthTimeline = (
    model: HealthTimelineModel,
    widthPx: number,
): {
    columns: HealthTimelineColumn[];
    displaySegments: HealthTimelineDisplaySegment[];
} => {
    const safeWidth = Math.max(1, Math.floor(widthPx));
    if (model.sourceSegments.length === 0 || model.durationMs <= 0) {
        return { columns: [], displaySegments: [] };
    }

    const sourceSegmentsById = new Map(model.sourceSegments.map((segment) => [segment.id, segment]));
    const reservedColumns = assignReservedColumns(model, safeWidth);
    const columns: HealthTimelineColumn[] = Array.from({ length: safeWidth }, (_, index) => {
        const startMs = model.windowStartMs + (model.durationMs * index) / safeWidth;
        const endMs = model.windowStartMs + (model.durationMs * (index + 1)) / safeWidth;
        const sourceSegments = getOverlappingSegments(model.sourceSegments, startMs, endMs);
        const worstState = worstStateForSegments(sourceSegments);
        return {
            index,
            startMs,
            endMs,
            displayState: worstState,
            worstState,
            sourceSegments,
            eventCount: uniqueEventsForSegments(sourceSegments).length,
            reservedSegmentId: null,
        };
    });

    for (const [segmentId, columnIndex] of reservedColumns.entries()) {
        const column = columns[columnIndex];
        const segment = sourceSegmentsById.get(segmentId);
        if (!column || !segment) {
            continue;
        }
        column.reservedSegmentId = segmentId;
        if (segment.state === "Unhealthy" || column.displayState !== "Unhealthy") {
            column.displayState = segment.state;
        }
    }

    const displaySegments: HealthTimelineDisplaySegment[] = [];
    for (const column of columns) {
        const selection = buildSelectionForColumn(column, sourceSegmentsById);
        const selectionKey = `${selection.kind}:${selection.state}:${selection.sourceSegments
            .map((segment) => segment.id)
            .join(",")}:${column.reservedSegmentId ?? "-"}`;
        const previous = displaySegments[displaySegments.length - 1];
        if (previous && previous.state === column.displayState && previous.id.endsWith(selectionKey)) {
            previous.endColumn = column.index;
            previous.endMs = column.endMs;
            continue;
        }
        displaySegments.push({
            id: `display-${column.index}-${selectionKey}`,
            startColumn: column.index,
            endColumn: column.index,
            startMs: column.startMs,
            endMs: column.endMs,
            state: column.displayState,
            selection,
        });
    }

    return { columns, displaySegments };
};

export const formatTimelineTickLabel = (timestampMs: number): string => {
    const date = new Date(timestampMs);
    if (Number.isNaN(date.getTime())) {
        return "--:--";
    }
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

export const getHealthTimelineTicks = (windowStartMs: number, windowEndMs: number): number[] => {
    const tickCount = 5;
    const duration = windowEndMs - windowStartMs;
    if (duration <= 0) {
        return [windowStartMs];
    }
    return Array.from({ length: tickCount }, (_, index) => windowStartMs + (duration * index) / (tickCount - 1));
};

export const selectMostRelevantTimelineEvent = (selection: HealthTimelineSelection): HealthTimelineEvent | null => {
    if (selection.events.length === 0) {
        return null;
    }
    return (
        [...selection.events].sort((left, right) => {
            const severityDelta = severityOf(right.state) - severityOf(left.state);
            if (severityDelta !== 0) {
                return severityDelta;
            }
            return right.timestampMs - left.timestampMs;
        })[0] ?? null
    );
};
