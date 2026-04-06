/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { AnalyticPopup } from "@/components/diagnostics/AnalyticPopup";
import { Button } from "@/components/ui/button";
import { formatActionDuration } from "@/lib/diagnostics/actionSummaryDisplay";
import { getHealthHistory, type HealthHistoryEntry } from "@/lib/diagnostics/healthHistory";
import {
  buildHealthTimelineModel,
  buildRenderedHealthTimeline,
  formatTimelineTickLabel,
  getHealthTimelineTicks,
  HEALTH_TIMELINE_DEFAULT_WINDOW_MS,
  HEALTH_TIMELINE_STATE_COLORS,
  HEALTH_TIMELINE_ZOOM_WINDOWS,
  selectMostRelevantTimelineEvent,
} from "@/lib/diagnostics/healthHistoryTimeline";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatDiagnosticsTimestamp } from "@/lib/diagnostics/timeFormat";

const TRACK_HEIGHT_PX = 18;
const DEFAULT_ZOOM_INDEX = HEALTH_TIMELINE_ZOOM_WINDOWS.length - 1;
const DEFAULT_TRACK_WIDTH_PX = 240;

const ZOOM_LABELS: Record<number, string> = {
  [15 * 60 * 1000]: "15m",
  [30 * 60 * 1000]: "30m",
  [60 * 60 * 1000]: "1h",
  [2 * 60 * 60 * 1000]: "2h",
  [4 * 60 * 60 * 1000]: "4h",
};

const PROBE_PRESENTATION = [
  { key: "rest", label: "REST" },
  { key: "ftp", label: "FTP" },
  { key: "telnet", label: "TELNET" },
  { key: "config", label: "CONFIG" },
  { key: "raster", label: "RASTER" },
  { key: "jiffy", label: "JIFFY" },
] as const satisfies ReadonlyArray<{
  key: keyof HealthHistoryEntry["probes"];
  label: string;
}>;

const OUTCOME_TONE: Record<string, string> = {
  Success: "text-success",
  Partial: "text-amber-500",
  Fail: "text-destructive",
  Skipped: "text-muted-foreground",
};

type Props = {
  open: boolean;
  onClose: () => void;
  history?: Readonly<HealthHistoryEntry[]>;
};

export function HealthHistoryPopup({ open, onClose, history: providedHistory }: Props) {
  const history = providedHistory ?? getHealthHistory();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [trackWidthPx, setTrackWidthPx] = useState(() =>
    typeof window !== "undefined"
      ? Math.max(DEFAULT_TRACK_WIDTH_PX, Math.floor(window.innerWidth - 128))
      : DEFAULT_TRACK_WIDTH_PX,
  );
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  const lastTimestampMs = useMemo(() => {
    const timestamps = history.map((entry) => Date.parse(entry.timestamp)).filter((value) => Number.isFinite(value));
    return timestamps[timestamps.length - 1] ?? Date.now();
  }, [history]);

  const windowEndMs = useMemo(() => Math.max(Date.now(), lastTimestampMs), [lastTimestampMs]);
  const windowDurationMs = HEALTH_TIMELINE_ZOOM_WINDOWS[zoomIndex] ?? HEALTH_TIMELINE_DEFAULT_WINDOW_MS;

  useEffect(() => {
    if (!open) return;
    setZoomIndex(DEFAULT_ZOOM_INDEX);
    setSelectedSegmentId(null);
    setExpandedEventId(null);
  }, [open]);

  useEffect(() => {
    setExpandedEventId(null);
  }, [selectedSegmentId]);

  useLayoutEffect(() => {
    if (!open || !trackRef.current) return;

    const measure = () => {
      if (!trackRef.current) return;
      const measuredWidth = Math.floor(trackRef.current.getBoundingClientRect().width || trackRef.current.clientWidth);
      const fallbackWidth =
        typeof window !== "undefined"
          ? Math.max(DEFAULT_TRACK_WIDTH_PX, Math.floor(window.innerWidth - 128))
          : DEFAULT_TRACK_WIDTH_PX;
      setTrackWidthPx(Math.max(DEFAULT_TRACK_WIDTH_PX, measuredWidth || fallbackWidth));
    };

    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(trackRef.current);
    window.addEventListener("resize", measure);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open]);

  const timelineModel = useMemo(
    () =>
      buildHealthTimelineModel(history, {
        nowMs: windowEndMs,
        windowDurationMs,
        windowEndMs,
      }),
    [history, windowDurationMs, windowEndMs],
  );

  const renderedTimeline = useMemo(
    () => buildRenderedHealthTimeline(timelineModel, trackWidthPx),
    [timelineModel, trackWidthPx],
  );

  const tickMarks = useMemo(
    () => getHealthTimelineTicks(timelineModel.windowStartMs, timelineModel.windowEndMs),
    [timelineModel.windowEndMs, timelineModel.windowStartMs],
  );

  const selectedSegment = useMemo(
    () => renderedTimeline.displaySegments.find((segment) => segment.id === selectedSegmentId) ?? null,
    [renderedTimeline.displaySegments, selectedSegmentId],
  );

  const selectedEvent = selectedSegment ? selectMostRelevantTimelineEvent(selectedSegment.selection) : null;
  const selectedTimelineEvents = useMemo(
    () =>
      selectedSegment
        ? [...selectedSegment.selection.events].sort((left, right) => right.timestampMs - left.timestampMs)
        : [],
    [selectedSegment],
  );

  return (
    <AnalyticPopup open={open} onClose={onClose} title="Health history" data-testid="health-history-popup">
      <div className="flex min-h-0 flex-1 flex-col p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setZoomIndex((value) => Math.max(0, value - 1))}
            disabled={zoomIndex <= 0}
            data-testid="health-history-zoom-in"
          >
            Zoom in
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setZoomIndex((value) => Math.min(HEALTH_TIMELINE_ZOOM_WINDOWS.length - 1, value + 1))}
            disabled={zoomIndex >= HEALTH_TIMELINE_ZOOM_WINDOWS.length - 1}
            data-testid="health-history-zoom-out"
          >
            Zoom out
          </Button>
          <span className="text-xs text-muted-foreground">
            {ZOOM_LABELS[windowDurationMs] ?? formatActionDuration(windowDurationMs)}
          </span>
        </div>

        {history.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">No data</div>
        ) : (
          <>
            <div className="rounded-xl border border-border/70 bg-card p-3" data-testid="health-history-timeline-panel">
              <div
                ref={trackRef}
                className="relative w-full overflow-hidden rounded-md bg-background"
                style={{ height: `${TRACK_HEIGHT_PX}px` }}
                data-testid="health-history-track"
              >
                {renderedTimeline.displaySegments.map((segment) => {
                  const widthPx = Math.max(1, segment.endColumn - segment.startColumn + 1);
                  return (
                    <button
                      key={segment.id}
                      type="button"
                      className="absolute inset-y-0 border-0 p-0"
                      style={{
                        left: `${segment.startColumn}px`,
                        width: `${widthPx}px`,
                        backgroundColor: HEALTH_TIMELINE_STATE_COLORS[segment.state],
                        opacity: selectedSegmentId === segment.id ? 0.78 : 1,
                        boxShadow:
                          selectedSegmentId === segment.id
                            ? "inset 0 0 0 2px rgba(15, 23, 42, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.85)"
                            : "none",
                      }}
                      onClick={() => setSelectedSegmentId(segment.id)}
                      data-testid={`health-history-segment-${segment.startColumn}`}
                      data-state={segment.state}
                      aria-label={`${segment.state} ${formatDiagnosticsTimestamp(segment.selection.startMs)}`}
                    />
                  );
                })}
              </div>
              <div
                className="mt-2 grid grid-cols-5 gap-2 text-[10px] text-muted-foreground"
                data-testid="health-history-axis"
              >
                {tickMarks.map((tick) => (
                  <span key={tick} className="truncate last:text-right">
                    {formatTimelineTickLabel(tick)}
                  </span>
                ))}
              </div>
            </div>

            {selectedSegment ? (
              <div
                className="mt-3 rounded-xl border border-border/70 bg-card p-3"
                data-testid="health-history-selection-overlay"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">{selectedSegment.selection.state}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDiagnosticsTimestamp(selectedSegment.selection.startMs)}
                      {selectedSegment.selection.endMs !== selectedSegment.selection.startMs
                        ? ` · ${formatDiagnosticsTimestamp(selectedSegment.selection.endMs)}`
                        : ""}
                    </p>
                  </div>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedSegmentId(null)}>
                    Dismiss
                  </Button>
                </div>
                <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <p>
                    Cause{" "}
                    <span data-testid="health-history-selection-reason">{selectedEvent?.rootCause ?? "Unknown"}</span>
                  </p>
                  <p>
                    Subsystem{" "}
                    <span data-testid="health-history-selection-subsystem">{selectedEvent?.subsystem ?? "-"}</span>
                  </p>
                </div>

                <div
                  className="mt-4 rounded-xl border border-border/70 bg-background/60 p-3"
                  data-testid="health-history-event-list"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Health checks in this range</p>
                      <p className="text-xs text-muted-foreground">
                        {selectedTimelineEvents.length} check{selectedTimelineEvents.length === 1 ? "" : "s"}
                        {selectedTimelineEvents.length > 0
                          ? ` · ${formatDiagnosticsTimestamp(selectedTimelineEvents[selectedTimelineEvents.length - 1]!.timestampMs)} to ${formatDiagnosticsTimestamp(selectedTimelineEvents[0]!.timestampMs)}`
                          : ""}
                      </p>
                    </div>
                  </div>

                  <div
                    className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1"
                    data-testid="health-history-event-scroll"
                  >
                    {selectedTimelineEvents.map((event) => {
                      const expanded = expandedEventId === event.id;
                      const entry = event.entry;
                      return (
                        <div
                          key={event.id}
                          className="rounded-xl border border-border/70 bg-card"
                          data-testid={`health-history-event-row-${event.id}`}
                        >
                          <button
                            type="button"
                            className="flex w-full items-start gap-3 p-3 text-left"
                            onClick={() => setExpandedEventId((current) => (current === event.id ? null : event.id))}
                            aria-expanded={expanded}
                          >
                            <span className="mt-0.5 text-muted-foreground" aria-hidden="true">
                              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </span>
                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <p className="text-sm font-semibold text-foreground">
                                    {formatDiagnosticsTimestamp(event.timestampMs)}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {event.state} · total {entry.durationMs}ms
                                  </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-xs">
                                  <span className="rounded-full border border-border/70 px-2 py-0.5 font-medium text-foreground">
                                    {entry.overallHealth}
                                  </span>
                                  <span className="font-mono text-muted-foreground">p50 {entry.latency.p50}ms</span>
                                  <span className="font-mono text-muted-foreground">p90 {entry.latency.p90}ms</span>
                                  <span className="font-mono text-muted-foreground">p99 {entry.latency.p99}ms</span>
                                </div>
                              </div>

                              {expanded ? (
                                <div className="space-y-2 border-t border-border/70 pt-3">
                                  <div className="grid gap-2 text-xs sm:grid-cols-2">
                                    {PROBE_PRESENTATION.map((probe) => {
                                      const result = entry.probes[probe.key];
                                      return (
                                        <div
                                          key={probe.key}
                                          className="rounded-lg border border-border/60 bg-background px-2.5 py-2"
                                          data-testid={`health-history-event-probe-${event.id}-${probe.key}`}
                                        >
                                          <div className="flex items-center justify-between gap-2">
                                            <span className="font-medium text-foreground">{probe.label}</span>
                                            <span className={OUTCOME_TONE[result.outcome] ?? "text-foreground"}>
                                              {result.outcome}
                                            </span>
                                          </div>
                                          <div className="mt-1 flex items-center justify-between gap-2 text-muted-foreground">
                                            <span className="break-words">{result.reason ?? "OK"}</span>
                                            <span className="shrink-0 font-mono">
                                              {result.durationMs != null ? `${result.durationMs}ms` : "-"}
                                            </span>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </AnalyticPopup>
  );
}
