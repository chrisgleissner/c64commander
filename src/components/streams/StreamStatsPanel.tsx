/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState } from "react";
import { Activity, ChevronDown, ChevronUp, Download, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useStreamStats } from "@/hooks/useStreamStats";
import { addLog } from "@/lib/logging";
import type { AvMirrorSession } from "@/lib/streams/avMirrorSession";
import type { StreamVideoFrameRateMode } from "@/lib/config/appSettings";
import type { TelemetryBucket } from "@/lib/streams/streamTelemetry";

export interface StreamStatsPanelProps {
  session?: AvMirrorSession;
  className?: string;
  /** Injectable diagnostic-export sink (default: download a JSON file). For tests. */
  onExport?: (payload: Record<string, unknown>) => void;
}

const MODES: ReadonlyArray<{ value: StreamVideoFrameRateMode; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "100", label: "100%" },
  { value: "50", label: "50%" },
  { value: "25", label: "25%" },
];

const pct = (percent: number): string => `${Math.round(percent)}%`;

const ms = (v: number): string => `${Math.round(v)} ms`;
const num = (v: number): string => `${Math.round(v)}`;

const fmtDuration = (durationMs: number): string => {
  const s = Math.floor(durationMs / 1000);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
};

/** Tiny dependency-free sparkline: normalises `values` into a 100×24 polyline. */
function Sparkline({ values, testid, ariaLabel }: { values: number[]; testid: string; ariaLabel: string }) {
  if (values.length < 2) {
    return (
      <div className="h-6 text-[10px] text-muted-foreground" data-testid={testid}>
        collecting…
      </div>
    );
  }
  const max = Math.max(1, ...values);
  const step = 100 / (values.length - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(24 - (v / max) * 22 - 1).toFixed(1)}`).join(" ");
  return (
    <svg
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      className="h-6 w-full"
      role="img"
      aria-label={ariaLabel}
      data-testid={testid}
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Stat({ label, value, testid, tone }: { label: string; value: string; testid: string; tone?: "warn" }) {
  return (
    <div className="rounded-md bg-muted/50 px-2 py-1.5 text-center">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={cn("text-sm font-semibold tabular-nums", tone === "warn" && "text-destructive")}
        data-testid={`stream-stats-${testid}`}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * User-visible Live View **Stats** (spec §12). A compact live summary plus an expandable detailed
 * view, lightweight history sparklines, and a diagnostic JSON export. Values come from the shared
 * session's governor + bounded telemetry via {@link useStreamStats}; opening this only adds a ~4 Hz
 * read, so it does not materially change streaming performance (§12.3).
 *
 * Latency is labelled honestly: this is the LOCAL present-queue residence, not sender→display
 * latency (which is floored by the C64U capture buffer + Wi-Fi — see the Live View gap analysis).
 */
const WINDOWS: ReadonlyArray<{ label: string; sec: number }> = [
  { label: "60s", sec: 60 },
  { label: "5m", sec: 300 },
  { label: "15m", sec: 900 },
  { label: "Session", sec: Number.MAX_SAFE_INTEGER },
];

export function StreamStatsPanel({ session, className, onExport }: StreamStatsPanelProps) {
  const { stats, requestedMode, setFrameRateMode, history, exportDiagnostics } = useStreamStats(session);
  const [expanded, setExpanded] = useState(false);
  const [windowSec, setWindowSec] = useState(60);

  const { governor, live, summary } = stats;
  const buckets: TelemetryBucket[] = history(windowSec);
  const fpsSeries = buckets.map((b) => b.fpsAvg);
  const bufferSeries = buckets.map((b) => b.audioBufferMsMin);
  const lossSeries = buckets.map((b) => b.videoDroppedPerSec + b.framesLostPerSec + b.audioLostPerSec);
  const concealSeries = buckets.map((b) => b.concealedPerSec);
  const rateSeries = buckets.map((b) => b.effectiveFraction * 100);

  const handleExport = () => {
    const payload = exportDiagnostics({ exportedAt: new Date().toISOString() });
    if (onExport) {
      onExport(payload);
      return;
    }
    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `live-view-stats-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      addLog("warn", "Stats: diagnostic export failed", { error: (error as Error)?.message ?? String(error) });
    }
  };

  return (
    <div className={cn("space-y-3 rounded-lg border border-border p-3", className)} data-testid="stream-stats">
      {/* Header: title + governor state + expand toggle */}
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="text-sm font-medium">Stats</span>
          <span className="text-xs text-muted-foreground tabular-nums" data-testid="stream-stats-duration">
            {fmtDuration(summary.durationMs)}
          </span>
        </span>
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-muted-foreground"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          data-testid="stream-stats-toggle"
        >
          {expanded ? "Less" : "More"}
          {expanded ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
        </button>
      </div>

      {/* Frame-rate mode selector (§11.1) */}
      <div className="flex items-center gap-1.5" data-testid="stream-stats-mode">
        <Gauge className="h-4 w-4 text-muted-foreground" aria-hidden />
        {MODES.map((m) => (
          <Button
            key={m.value}
            size="sm"
            variant={requestedMode === m.value ? "default" : "outline"}
            className="h-7 px-2 text-xs"
            onClick={() => setFrameRateMode(m.value)}
            data-testid={`stream-stats-mode-${m.value}`}
            aria-pressed={requestedMode === m.value}
          >
            {m.label}
          </Button>
        ))}
        {governor.overridden && (
          <span
            className="ml-1 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive"
            data-testid="stream-stats-override"
            title={governor.reason}
          >
            auto-reduced → {pct(governor.effectivePercent)}
          </span>
        )}
      </div>

      {/* Compact live summary */}
      <div className="grid grid-cols-4 gap-2">
        <Stat label="FPS" value={num(live.fps)} testid="fps" />
        <Stat label="Rate" value={pct(governor.effectivePercent)} testid="rate" />
        <Stat
          label="Audio buf"
          value={ms(live.audioBufferMs)}
          testid="audio-buffer"
          tone={live.audioBufferMs > 0 && live.audioBufferMs < 30 ? "warn" : undefined}
        />
        <Stat
          label="Underruns"
          value={num(live.audioUnderruns)}
          testid="underruns"
          tone={live.audioUnderruns > 0 ? "warn" : undefined}
        />
      </div>

      {expanded && (
        <div className="space-y-3" data-testid="stream-stats-details">
          {/* History window selector (§12.2) */}
          <div className="flex items-center gap-1.5" data-testid="stream-stats-window">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">History</span>
            {WINDOWS.map((w) => (
              <Button
                key={w.label}
                size="sm"
                variant={windowSec === w.sec ? "default" : "outline"}
                className="h-6 px-2 text-[11px]"
                onClick={() => setWindowSec(w.sec)}
                data-testid={`stream-stats-window-${w.label}`}
                aria-pressed={windowSec === w.sec}
              >
                {w.label}
              </Button>
            ))}
          </div>

          {/* History charts (§12.3) */}
          <div className="grid grid-cols-2 gap-3">
            <div className="text-muted-foreground">
              <div className="mb-1 text-[10px] uppercase tracking-wide">Presented FPS</div>
              <Sparkline values={fpsSeries} testid="stream-stats-spark-fps" ariaLabel="Presented FPS over the window" />
            </div>
            <div className="text-muted-foreground">
              <div className="mb-1 text-[10px] uppercase tracking-wide">Audio buffer min (ms)</div>
              <Sparkline
                values={bufferSeries}
                testid="stream-stats-spark-buffer"
                ariaLabel="Minimum audio buffer depth over the window"
              />
            </div>
            <div className="text-muted-foreground">
              <div className="mb-1 text-[10px] uppercase tracking-wide">Loss (pkts+frames/s)</div>
              <Sparkline
                values={lossSeries}
                testid="stream-stats-spark-loss"
                ariaLabel="Packet + frame loss per second"
              />
            </div>
            <div className="text-muted-foreground">
              <div className="mb-1 text-[10px] uppercase tracking-wide">Concealed audio/s</div>
              <Sparkline
                values={concealSeries}
                testid="stream-stats-spark-conceal"
                ariaLabel="Concealed audio packets per second"
              />
            </div>
            <div className="col-span-2 text-muted-foreground">
              <div className="mb-1 text-[10px] uppercase tracking-wide">Effective video rate (%)</div>
              <Sparkline
                values={rateSeries}
                testid="stream-stats-spark-rate"
                ariaLabel="Governor effective video rate percent"
              />
            </div>
          </div>

          {/* Latency / residence — honestly labelled LOCAL pipeline residence */}
          <section data-testid="stream-stats-latency">
            <div className="mb-1 text-[11px] font-medium">Local pipeline residence</div>
            <div className="grid grid-cols-4 gap-2">
              <Stat label="Now" value={ms(live.renderResidenceMs)} testid="residence-now" />
              <Stat label="p95" value={ms(summary.residence.p95)} testid="residence-p95" />
              <Stat label="p99" value={ms(summary.residence.p99)} testid="residence-p99" />
              <Stat label="Max" value={ms(live.maxResidenceMs)} testid="residence-max" />
            </div>
          </section>

          {/* Video presentation-slot accounting (§9.1) */}
          <section data-testid="stream-stats-video">
            <div className="mb-1 text-[11px] font-medium">Video ({live.standard})</div>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Presented" value={num(live.presented)} testid="presented" />
              <Stat label="Partial" value={num(live.partialConcealed)} testid="partial" />
              <Stat label="Repeated" value={num(live.repeatedFrames)} testid="repeated" />
              <Stat label="Decimated" value={num(live.decimated)} testid="decimated" />
              <Stat label="Backlog" value={num(live.backlogReplacements)} testid="backlog" />
              <Stat label="Lost" value={num(live.framesLost)} testid="frames-lost" />
            </div>
          </section>

          {/* Audio */}
          <section data-testid="stream-stats-audio">
            <div className="mb-1 text-[11px] font-medium">Audio</div>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Concealed" value={num(live.audioConcealed)} testid="concealed" />
              <Stat label="Dropped pkts" value={num(live.droppedPackets)} testid="dropped-packets" />
              <Stat label="Buf min" value={ms(summary.audioBufferMsMin)} testid="audio-buffer-min" />
            </div>
          </section>

          {/* Governor */}
          <section data-testid="stream-stats-governor">
            <div className="mb-1 text-[11px] font-medium">Governor</div>
            <p className="text-[11px] text-muted-foreground" data-testid="stream-stats-governor-reason">
              requested <strong>{governor.requested}</strong> · effective{" "}
              <strong>{pct(governor.effectivePercent)}</strong>
              {governor.reason ? ` · ${governor.reason}` : ""}
            </p>
          </section>

          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={handleExport} data-testid="stream-stats-export">
              <Download className="mr-1 h-3.5 w-3.5" /> Export diagnostics
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
