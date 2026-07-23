/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Activity, Keyboard, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAvSync } from "@/hooks/useAvSync";
import type { AvMirrorSession } from "@/lib/streams/avMirrorSession";
import type { AvSyncStats } from "@/lib/streams/avSync";

export interface AvSyncPanelProps {
  session?: AvMirrorSession;
  className?: string;
}

const fmtMs = (value: number | null): string => {
  if (value === null) return "—";
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded} ms`;
};

/** Latency values are non-negative durations — no leading '+'. */
const fmtLatency = (value: number | null): string => (value === null ? "—" : `${Math.round(value)} ms`);

const STAT_FIELDS: ReadonlyArray<{ label: string; key: keyof AvSyncStats; testid: string }> = [
  { label: "Last", key: "lastMs", testid: "last" },
  { label: "Min", key: "minMs", testid: "min" },
  { label: "Avg", key: "avgMs", testid: "avg" },
  { label: "P90", key: "p90Ms", testid: "p90" },
  { label: "P99", key: "p99Ms", testid: "p99" },
  { label: "Max", key: "maxMs", testid: "max" },
];

/**
 * Measures and displays the app's audio↔video sync. Runs the bundled av-sync-auto program
 * on the device (periodic aligned white-flash + tone), then reports the offset (audio − video)
 * across matched pops — most recent plus min / avg / p90 / p99 / max — with a reset.
 */
export function AvSyncPanel({ session, className }: AvSyncPanelProps) {
  const { stats, latencyStats, reset, runTest, runKeyTest, pressSpace, runningTest, testError } = useAvSync(session);

  return (
    <div className={cn("rounded-lg border border-border p-3", className)} data-testid="av-sync-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="text-sm font-medium">A/V Sync</span>
          <span className="text-xs text-muted-foreground" data-testid="av-sync-count">
            {stats.count} {stats.count === 1 ? "pop" : "pops"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void runTest()}
            disabled={runningTest}
            data-testid="av-sync-run"
          >
            {runningTest ? "Starting…" : "Run test"}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={reset}
            aria-label="Reset A/V sync statistics"
            data-testid="av-sync-reset"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {STAT_FIELDS.map((field) => (
          <div key={field.key} className="rounded-md bg-muted/50 px-2 py-1.5 text-center">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{field.label}</div>
            <div className="text-sm font-semibold tabular-nums" data-testid={`av-sync-stat-${field.testid}`}>
              {fmtMs(stats[field.key] as number | null)}
            </div>
          </div>
        ))}
      </div>

      {testError ? (
        <p className="mt-2 text-xs text-destructive" role="alert" data-testid="av-sync-error">
          {testError}
        </p>
      ) : (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Positive means audio lags the picture. Tap <strong>Run test</strong> with Listen and Watch both on.
        </p>
      )}

      {/* Interactive space-triggered latency: press → see/hear latency + the pop's A/V offset. */}
      <div className="mt-3 border-t border-border pt-3" data-testid="av-sync-latency">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Keyboard className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="text-sm font-medium">Tap latency</span>
            <span className="text-xs text-muted-foreground" data-testid="av-sync-lat-count">
              {latencyStats.count} {latencyStats.count === 1 ? "tap" : "taps"}
              {latencyStats.missed > 0 ? ` · ${latencyStats.missed} missed` : ""}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void runKeyTest()}
              disabled={runningTest}
              data-testid="av-sync-key-load"
            >
              {runningTest ? "Starting…" : "Load"}
            </Button>
            <Button size="sm" onClick={() => void pressSpace()} disabled={runningTest} data-testid="av-sync-press">
              Send SPACE
            </Button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-md bg-muted/50 px-2 py-1.5 text-center">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">See P99</div>
            <div className="text-sm font-semibold tabular-nums" data-testid="av-sync-lat-see">
              {fmtLatency(latencyStats.seeP99Ms)}
            </div>
          </div>
          <div className="rounded-md bg-muted/50 px-2 py-1.5 text-center">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Hear P99</div>
            <div className="text-sm font-semibold tabular-nums" data-testid="av-sync-lat-hear">
              {fmtLatency(latencyStats.hearP99Ms)}
            </div>
          </div>
          <div className="rounded-md bg-muted/50 px-2 py-1.5 text-center">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Offset P99</div>
            <div className="text-sm font-semibold tabular-nums" data-testid="av-sync-lat-offset">
              {fmtLatency(latencyStats.offsetP99Ms)}
            </div>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Load the space program, then <strong>Send SPACE</strong> repeatedly. Measures press → see / hear latency and
          the pop&apos;s audio↔video offset.
        </p>
      </div>
    </div>
  );
}
