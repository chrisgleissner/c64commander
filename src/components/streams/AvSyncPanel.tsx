/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState, type ReactNode } from "react";
import { Activity, ChevronDown, ChevronUp, Keyboard, RotateCcw, Square } from "lucide-react";
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

/** A collapsible section with a header (icon + title + summary) and a toggle chevron. */
function CollapsibleSection({
  icon,
  title,
  summary,
  testid,
  children,
  className,
}: {
  icon: ReactNode;
  title: string;
  summary: ReactNode;
  testid: string;
  children: ReactNode;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={cn("rounded-lg border border-border p-3", className)} data-testid={`${testid}-section`}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        data-testid={`${testid}-toggle`}
      >
        <span className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium">{title}</span>
          {summary}
        </span>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
        )}
      </button>
      {expanded && (
        <div className="mt-3" data-testid={`${testid}-body`}>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * The Home A/V measurement tools, two independently collapsible sections (both collapsed by
 * default — measurement is a power-user diagnostic):
 *  - A/V Sync: runs the bundled av-sync-auto program (periodic aligned white-flash + tone) and
 *    reports the audio↔video offset across matched pops (last / min / avg / p90 / p99 / max).
 *  - Tap latency: loads the space-triggered av-sync-key program; each Send SPACE measures the
 *    press→see and press→hear round-trip plus the pop's A/V offset, surfacing the latest value at
 *    once (with p99 as it accrues).
 *
 * Either test runs a RAM-resident program on the device; Stop resets the C64 to end it.
 */
export function AvSyncPanel({ session, className }: AvSyncPanelProps) {
  const { stats, latencyStats, reset, runTest, runKeyTest, pressSpace, stopTest, testActive, runningTest, testError } =
    useAvSync(session);

  const stopButton = testActive ? (
    <Button
      size="sm"
      variant="destructive"
      onClick={() => void stopTest()}
      disabled={runningTest}
      data-testid="av-sync-stop"
    >
      <Square className="mr-1 h-3.5 w-3.5" /> Stop
    </Button>
  ) : null;

  return (
    <div className={cn("space-y-3", className)} data-testid="av-sync-panel">
      <CollapsibleSection
        testid="av-sync"
        icon={<Activity className="h-4 w-4 text-muted-foreground" aria-hidden />}
        title="A/V Sync"
        summary={
          <span className="text-xs text-muted-foreground" data-testid="av-sync-count">
            {stats.count} {stats.count === 1 ? "pop" : "pops"}
          </span>
        }
      >
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {stopButton}
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
      </CollapsibleSection>

      <CollapsibleSection
        testid="av-sync-lat"
        icon={<Keyboard className="h-4 w-4 text-muted-foreground" aria-hidden />}
        title="Tap latency"
        summary={
          <span className="text-xs text-muted-foreground" data-testid="av-sync-lat-count">
            {latencyStats.count} {latencyStats.count === 1 ? "tap" : "taps"}
            {latencyStats.missed > 0 ? ` · ${latencyStats.missed} missed` : ""}
          </span>
        }
      >
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {stopButton}
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

        <div className="mt-3 grid grid-cols-3 gap-2">
          {(
            [
              { label: "See", last: latencyStats.seeLastMs, p99: latencyStats.seeP99Ms, testid: "see" },
              { label: "Hear", last: latencyStats.hearLastMs, p99: latencyStats.hearP99Ms, testid: "hear" },
              { label: "Offset", last: latencyStats.offsetLastMs, p99: latencyStats.offsetP99Ms, testid: "offset" },
            ] as const
          ).map((field) => (
            <div key={field.testid} className="rounded-md bg-muted/50 px-2 py-1.5 text-center">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{field.label}</div>
              <div className="text-sm font-semibold tabular-nums" data-testid={`av-sync-lat-${field.testid}`}>
                {fmtLatency(field.last)}
              </div>
              <div className="text-[9px] tabular-nums text-muted-foreground" data-testid={`av-sync-lat-${field.testid}-p99`}>
                p99 {fmtLatency(field.p99)}
              </div>
            </div>
          ))}
        </div>

        {testError ? (
          <p className="mt-2 text-xs text-destructive" role="alert" data-testid="av-sync-lat-error">
            {testError}
          </p>
        ) : (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Load the space program, then <strong>Send SPACE</strong> repeatedly. Shows the latest press → see / hear
            latency and the pop&apos;s audio↔video offset right away.
          </p>
        )}
      </CollapsibleSection>
    </div>
  );
}
