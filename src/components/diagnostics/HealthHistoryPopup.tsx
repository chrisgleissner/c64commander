/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// §13 — Health history nested analytic popup.
// Visualises health states over time using a categorical Y-axis.

import { AnalyticPopup } from "@/components/diagnostics/AnalyticPopup";
import { Button } from "@/components/ui/button";
import { getHealthHistory, type HealthHistoryEntry } from "@/lib/diagnostics/healthHistory";
import type { HealthState } from "@/lib/diagnostics/healthModel";
import { getRecoveryEvidence } from "@/lib/diagnostics/recoveryEvidence";
import { CartesianGrid, Cell, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { useEffect, useMemo, useState } from "react";
import { HEALTH_GLYPHS } from "@/lib/diagnostics/healthModel";
import { formatDiagnosticsTimestamp } from "@/lib/diagnostics/timeFormat";

// §13.3 — Y-axis bands (top → bottom per spec)
const HEALTH_BANDS: HealthState[] = ["Unavailable", "Unhealthy", "Degraded", "Healthy", "Idle"];

const BAND_COLORS: Record<HealthState, string> = {
  Unavailable: "hsl(var(--muted-foreground))",
  Unhealthy: "hsl(var(--destructive))",
  Degraded: "hsl(39 100% 57%)",
  Healthy: "hsl(var(--success, 142 71% 45%))",
  Idle: "hsl(var(--muted-foreground))",
};

type ChartPoint = {
  timestampMs: number;
  health: HealthState;
  yIndex: number;
  durationMs: number;
  label: string;
};

type OverlayPoint = {
  timestampMs: number;
  yIndex: number;
  label: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

export function HealthHistoryPopup({ open, onClose }: Props) {
  const history: Readonly<HealthHistoryEntry[]> = getHealthHistory();
  const recoveryEvents = getRecoveryEvidence();
  const [zoom, setZoom] = useState(50);
  const [windowStart, setWindowStart] = useState(0);

  const points = useMemo<ChartPoint[]>(() => {
    return history.map((entry) => ({
      timestampMs: new Date(entry.timestamp).getTime(),
      health: entry.overallHealth,
      yIndex: HEALTH_BANDS.indexOf(entry.overallHealth),
      durationMs: entry.durationMs,
      label: entry.overallHealth,
    }));
  }, [history]);

  useEffect(() => {
    if (!open) return;
    setZoom(50);
    setWindowStart(0);
  }, [open]);

  const visiblePoints = useMemo(() => {
    if (points.length <= zoom) {
      return points;
    }
    const maxStart = Math.max(0, points.length - zoom);
    const clampedStart = Math.min(windowStart, maxStart);
    return points.slice(clampedStart, clampedStart + zoom);
  }, [points, windowStart, zoom]);

  const visibleWindow = useMemo(() => {
    if (visiblePoints.length === 0) {
      return null;
    }
    return {
      min: visiblePoints[0].timestampMs,
      max: visiblePoints[visiblePoints.length - 1].timestampMs,
    };
  }, [visiblePoints]);

  const overlayPoints = useMemo<OverlayPoint[]>(() => {
    if (!visibleWindow) return [];
    return recoveryEvents
      .filter((event) => {
        const timestampMs = new Date(event.timestamp).getTime();
        return timestampMs >= visibleWindow.min && timestampMs <= visibleWindow.max;
      })
      .map((event) => ({
        timestampMs: new Date(event.timestamp).getTime(),
        yIndex: -0.2,
        label: `${event.kind} · ${event.outcome}`,
      }));
  }, [recoveryEvents, visibleWindow]);

  const isEmpty = points.length === 0;
  const canPan = points.length > zoom;
  const maxWindowStart = Math.max(0, points.length - zoom);

  return (
    <AnalyticPopup
      open={open}
      onClose={onClose}
      title="Health history"
      description="Health check outcomes over the current diagnostics session."
      data-testid="health-history-popup"
    >
      <div className="flex flex-1 min-h-0 flex-col p-3">
        {isEmpty ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <p>No health check history yet.</p>
            <p className="text-xs">Run a health check to start recording history.</p>
          </div>
        ) : (
          <>
            <div className="mb-2 flex items-center gap-3 flex-wrap shrink-0">
              {HEALTH_BANDS.map((band) => (
                <div key={band} className="flex items-center gap-1 text-xs">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: BAND_COLORS[band] }}
                    aria-hidden="true"
                  />
                  <span className="font-mono">{HEALTH_GLYPHS[band]}</span>
                  <span>{band}</span>
                </div>
              ))}
            </div>

            <div className="mb-2 flex items-center gap-2 shrink-0 flex-wrap">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setZoom((current) => Math.max(10, current - 10))}
                disabled={zoom <= 10}
                data-testid="health-history-zoom-in"
              >
                Zoom in
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setZoom((current) => Math.min(Math.max(points.length, 10), current + 10))}
                disabled={zoom >= points.length}
                data-testid="health-history-zoom-out"
              >
                Zoom out
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setWindowStart((current) => Math.max(0, current - 10))}
                disabled={!canPan || windowStart <= 0}
                data-testid="health-history-pan-left"
              >
                Earlier
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setWindowStart((current) => Math.min(maxWindowStart, current + 10))}
                disabled={!canPan || windowStart >= maxWindowStart}
                data-testid="health-history-pan-right"
              >
                Later
              </Button>
              <span className="text-xs text-muted-foreground">
                Showing {visiblePoints.length} of {points.length} checks
              </span>
            </div>

            <ResponsiveContainer width="100%" height={220}>
              <ScatterChart margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis
                  dataKey="timestampMs"
                  type="number"
                  domain={visibleWindow ? [visibleWindow.min, visibleWindow.max] : ["dataMin", "dataMax"]}
                  scale="time"
                  tickFormatter={(v: number) => {
                    const d = new Date(v);
                    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
                  }}
                  tick={{ fontSize: 10 }}
                  name="Time"
                />
                <YAxis
                  dataKey="yIndex"
                  type="number"
                  domain={[-0.5, HEALTH_BANDS.length - 0.5]}
                  ticks={HEALTH_BANDS.map((_, i) => i)}
                  tickFormatter={(i: number) => HEALTH_BANDS[i] ?? ""}
                  tick={{ fontSize: 10 }}
                  width={72}
                  name="Health"
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0]?.payload as ChartPoint | undefined;
                    if (!d) return null;
                    return (
                      <div className="rounded border bg-popover px-2 py-1.5 text-xs shadow-md">
                        <p className="font-medium">
                          {formatDiagnosticsTimestamp(new Date(d.timestampMs).toISOString())}
                        </p>
                        <p>
                          {HEALTH_GLYPHS[d.health]} {d.health}
                        </p>
                        <p className="text-muted-foreground">{d.durationMs}ms</p>
                      </div>
                    );
                  }}
                />
                <Scatter name="Health" data={visiblePoints}>
                  {visiblePoints.map((p, idx) => (
                    <Cell key={`cell-${idx}`} fill={BAND_COLORS[p.health]} />
                  ))}
                </Scatter>
                {overlayPoints.length > 0 && (
                  <Scatter name="Recovery events" data={overlayPoints} fill="hsl(var(--foreground))" />
                )}
              </ScatterChart>
            </ResponsiveContainer>

            <p className="text-xs text-muted-foreground mt-2 shrink-0">
              {history.length} check{history.length !== 1 ? "s" : ""} recorded. Recovery overlays mark reconnect and
              switch events in the visible range.
            </p>
          </>
        )}
      </div>
    </AnalyticPopup>
  );
}
