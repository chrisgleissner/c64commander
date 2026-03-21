/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { AnalyticPopup } from "@/components/diagnostics/AnalyticPopup";
import { Button } from "@/components/ui/button";
import { formatActionDuration } from "@/lib/diagnostics/actionSummaryDisplay";
import { getHealthHistory } from "@/lib/diagnostics/healthHistory";
import {
  buildHealthTimelineModel,
  buildRenderedHealthTimeline,
  formatTimelineTickLabel,
  getHealthTimelineTicks,
  HEALTH_TIMELINE_DEFAULT_WINDOW_MS,
  HEALTH_TIMELINE_LEGEND_STATES,
  HEALTH_TIMELINE_STATE_COLORS,
  HEALTH_TIMELINE_ZOOM_WINDOWS,
  selectMostRelevantTimelineEvent,
} from "@/lib/diagnostics/healthHistoryTimeline";
import { formatDiagnosticsTimestamp } from "@/lib/diagnostics/timeFormat";
import { useEffect, useMemo, useRef, useState } from "react";

const TRACK_HEIGHT_PX = 28;
const DEFAULT_ZOOM_INDEX = HEALTH_TIMELINE_ZOOM_WINDOWS.length - 1;

const ZOOM_LABELS: Record<number, string> = {
  [15 * 60 * 1000]: "15m",
  [30 * 60 * 1000]: "30m",
  [60 * 60 * 1000]: "1h",
  [2 * 60 * 60 * 1000]: "2h",
  [4 * 60 * 60 * 1000]: "4h",
};

type Props = {
  open: boolean;
  onClose: () => void;
};

export function HealthHistoryPopup({ open, onClose }: Props) {
  const history = getHealthHistory();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [trackWidthPx, setTrackWidthPx] = useState(1);
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);

  const lastTimestampMs = useMemo(() => {
    const timestamps = history
      .map((entry) => Date.parse(entry.timestamp))
      .filter((timestampMs) => Number.isFinite(timestampMs));
    return timestamps[timestamps.length - 1] ?? Date.now();
  }, [history]);

  const windowEndMs = useMemo(() => Math.max(Date.now(), lastTimestampMs), [lastTimestampMs]);
  const windowDurationMs = HEALTH_TIMELINE_ZOOM_WINDOWS[zoomIndex] ?? HEALTH_TIMELINE_DEFAULT_WINDOW_MS;

  useEffect(() => {
    if (!open) {
      return;
    }
    setZoomIndex(DEFAULT_ZOOM_INDEX);
    setSelectedSegmentId(null);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const element = trackRef.current;
    if (!element) {
      return;
    }

    const measure = () => {
      const nextWidth = Math.max(1, Math.floor(element.getBoundingClientRect().width));
      setTrackWidthPx(nextWidth);
    };

    measure();

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            measure();
          })
        : null;

    resizeObserver?.observe(element);
    window.addEventListener("resize", measure);

    return () => {
      resizeObserver?.disconnect();
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

  const selectedSegment = useMemo(
    () => renderedTimeline.displaySegments.find((segment) => segment.id === selectedSegmentId) ?? null,
    [renderedTimeline.displaySegments, selectedSegmentId],
  );

  const selectedEvent = selectedSegment ? selectMostRelevantTimelineEvent(selectedSegment.selection) : null;
  const isEmpty = history.length === 0;
  const tickMarks = useMemo(
    () => getHealthTimelineTicks(timelineModel.windowStartMs, timelineModel.windowEndMs),
    [timelineModel.windowEndMs, timelineModel.windowStartMs],
  );

  return (
    <AnalyticPopup
      open={open}
      onClose={onClose}
      title="Health history"
      description="Single-state timeline over the current diagnostics window."
      data-testid="health-history-popup"
    >
      <div className="flex flex-1 min-h-0 flex-col p-3">
        <div className="mb-3 space-y-1 rounded-lg border border-border/60 bg-background/70 p-3 text-xs">
          <p className="font-medium text-foreground">
            Purpose: Shows how health changed across the current diagnostics window.
          </p>
          <p className="text-muted-foreground">
            Interpretation: A worsening segment points to when the system moved from stable to degraded or unhealthy.
          </p>
        </div>
        {isEmpty ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <p>No health check history yet.</p>
            <p className="text-xs">Run a health check to start recording history.</p>
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-3 flex-wrap shrink-0" data-testid="health-history-legend">
              {HEALTH_TIMELINE_LEGEND_STATES.map((state) => (
                <div key={state} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span
                    className="inline-block h-2.5 w-4 rounded-sm"
                    style={{ backgroundColor: HEALTH_TIMELINE_STATE_COLORS[state] }}
                    aria-hidden="true"
                  />
                  <span>{state}</span>
                </div>
              ))}
            </div>

            <div className="mb-3 flex items-center gap-2 shrink-0 flex-wrap">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setZoomIndex((current) => Math.max(0, current - 1))}
                disabled={zoomIndex <= 0}
                data-testid="health-history-zoom-in"
              >
                Zoom in
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setZoomIndex((current) => Math.min(HEALTH_TIMELINE_ZOOM_WINDOWS.length - 1, current + 1))
                }
                disabled={zoomIndex >= HEALTH_TIMELINE_ZOOM_WINDOWS.length - 1}
                data-testid="health-history-zoom-out"
              >
                Zoom out
              </Button>
              <span className="text-xs text-muted-foreground">
                Visible window {ZOOM_LABELS[windowDurationMs] ?? formatActionDuration(windowDurationMs)}
              </span>
            </div>

            <div
              className="rounded-lg border border-border bg-muted/20 p-3"
              data-testid="health-history-timeline-panel"
            >
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
                      onClick={() => setSelectedSegmentId(segment.id)}
                      className="absolute inset-y-0 border-0 p-0"
                      style={{
                        left: `${segment.startColumn}px`,
                        width: `${widthPx}px`,
                        backgroundColor: HEALTH_TIMELINE_STATE_COLORS[segment.state],
                        opacity: selectedSegmentId === segment.id ? 0.92 : 1,
                      }}
                      data-testid={`health-history-segment-${segment.startColumn}`}
                      data-state={segment.state}
                      aria-label={`${segment.state} from ${formatDiagnosticsTimestamp(segment.selection.startMs)} to ${formatDiagnosticsTimestamp(segment.selection.endMs)}`}
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

            <div
              className="mt-3 rounded-md border border-border bg-background/80 p-3 text-xs"
              data-testid="health-history-summary"
            >
              <p className="text-muted-foreground">
                Showing the last {ZOOM_LABELS[windowDurationMs] ?? formatActionDuration(windowDurationMs)} with{" "}
                {history.length} recorded health check
                {history.length !== 1 ? "s" : ""}. Tap the timeline to inspect a segment.
              </p>
            </div>

            {selectedSegment && (
              <div
                className="mt-3 rounded-lg border border-border bg-background p-3 shadow-sm"
                data-testid="health-history-selection-overlay"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1.5">
                    {selectedSegment.selection.kind === "aggregated" ? (
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Aggregated interval
                      </p>
                    ) : (
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Segment detail
                      </p>
                    )}
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-4 rounded-sm"
                        style={{ backgroundColor: HEALTH_TIMELINE_STATE_COLORS[selectedSegment.selection.state] }}
                        aria-hidden="true"
                      />
                      <span className="text-sm font-medium">{selectedSegment.selection.state}</span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelectedSegmentId(null)}
                    data-testid="health-history-selection-dismiss"
                  >
                    Dismiss
                  </Button>
                </div>

                <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
                  <p>
                    Start{" "}
                    <span className="font-mono">{formatDiagnosticsTimestamp(selectedSegment.selection.startMs)}</span>
                  </p>
                  <p>
                    End <span className="font-mono">{formatDiagnosticsTimestamp(selectedSegment.selection.endMs)}</span>
                  </p>
                  <p>
                    Duration{" "}
                    <span className="font-mono">
                      {formatActionDuration(selectedSegment.selection.endMs - selectedSegment.selection.startMs)}
                    </span>
                  </p>
                  <p>
                    Events <span className="font-mono">{selectedSegment.selection.eventCount}</span>
                  </p>
                  {selectedSegment.selection.kind === "aggregated" && (
                    <p>
                      Worst state <span className="font-medium">{selectedSegment.selection.worstState}</span>
                    </p>
                  )}
                  <p>
                    Subsystem <span className="font-medium">{selectedEvent?.subsystem ?? "—"}</span>
                  </p>
                </div>

                <div className="mt-3 space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Root cause</p>
                  <p data-testid="health-history-selection-reason">
                    {selectedEvent?.rootCause ?? "No diagnostic detail recorded for this interval."}
                  </p>
                </div>

                <div className="mt-3 space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Error message or code
                  </p>
                  <p data-testid="health-history-selection-error">{selectedEvent?.errorMessage ?? "—"}</p>
                </div>

                {selectedSegment.selection.kind === "aggregated" && selectedSegment.selection.events.length > 0 && (
                  <details className="mt-3" data-testid="health-history-selection-events">
                    <summary className="cursor-pointer text-xs font-medium">Show underlying events</summary>
                    <div className="mt-2 space-y-2">
                      {selectedSegment.selection.events.map((event) => (
                        <div key={event.id} className="rounded border border-border px-2 py-1.5 text-xs">
                          <p className="font-mono">{formatDiagnosticsTimestamp(event.timestampMs)}</p>
                          <p>
                            {event.state}
                            {event.subsystem ? ` · ${event.subsystem}` : ""}
                          </p>
                          <p className="text-muted-foreground">{event.rootCause}</p>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </AnalyticPopup>
  );
}
