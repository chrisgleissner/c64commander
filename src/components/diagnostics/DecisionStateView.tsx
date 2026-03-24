/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActionSummary } from "@/lib/diagnostics/actionSummaries";
import { useDecisionState } from "@/lib/diagnostics/decisionState";
import { useHealthCheckState } from "@/lib/diagnostics/healthCheckState";
import { formatDiagnosticsTimestamp } from "@/lib/diagnostics/timeFormat";

type Props = {
  onBack: () => void;
  onRepair: () => void | Promise<void>;
  repairRunning: boolean;
  actionSummaries: ActionSummary[];
};

const MetricRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-start justify-between gap-3 text-xs">
    <span className="text-muted-foreground">{label}</span>
    <span className="text-right font-mono text-foreground">{value}</span>
  </div>
);

export function DecisionStateView({ onBack, onRepair, repairRunning, actionSummaries }: Props) {
  const decisionState = useDecisionState();
  const healthCheckState = useHealthCheckState();

  const recentEffects = actionSummaries
    .flatMap((summary) =>
      (summary.effects ?? [])
        .filter((effect) => effect.type === "REST" || effect.type === "FTP")
        .map((effect) => ({ summary, effect })),
    )
    .slice(0, 6);

  const restDurations = recentEffects
    .filter((entry) => entry.effect.type === "REST" && typeof entry.effect.durationMs === "number")
    .map((entry) => entry.effect.durationMs as number);
  const ftpDurations = recentEffects
    .filter((entry) => entry.effect.type === "FTP" && typeof entry.effect.durationMs === "number")
    .map((entry) => entry.effect.durationMs as number);

  const average = (values: number[]) =>
    values.length === 0 ? "-" : `${Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)}ms`;

  return (
    <div className="space-y-3" data-testid="decision-state-view">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={onBack}
          className="-ml-1.5 h-7 px-1.5"
          data-testid="decision-state-back"
          aria-label="Back to diagnostics"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold text-foreground">Decision State</h3>
          <p className="text-xs text-muted-foreground">Internal reconciliation and uncertainty signals.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto h-7 text-xs"
          onClick={() => void onRepair()}
          disabled={repairRunning}
          data-testid="decision-state-repair"
        >
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${repairRunning ? "animate-spin" : ""}`} aria-hidden="true" />
          {repairRunning ? "Repairing" : "Resync / Repair"}
        </Button>
      </div>

      <section className="space-y-2 rounded border border-border/70 p-2" data-testid="decision-state-playback">
        <p className="text-xs font-semibold text-foreground">Playback</p>
        <MetricRow label="State" value={decisionState.playback.state} />
        <MetricRow label="Confidence" value={decisionState.playback.confidence} />
        <MetricRow
          label="Last update"
          value={
            decisionState.playback.lastUpdatedAt
              ? formatDiagnosticsTimestamp(decisionState.playback.lastUpdatedAt)
              : "-"
          }
        />
        <MetricRow label="Reason" value={decisionState.playback.reason ?? "-"} />
      </section>

      <section className="space-y-2 rounded border border-border/70 p-2" data-testid="decision-state-reconcilers">
        <p className="text-xs font-semibold text-foreground">Reconcilers</p>
        {Object.values(decisionState.reconcilers).map((reconciler) => (
          <div key={reconciler.key} className="space-y-1 rounded border border-border/60 bg-muted/20 p-2">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-medium capitalize text-foreground">{reconciler.key}</span>
              <span className="font-mono text-muted-foreground">{reconciler.result}</span>
            </div>
            <MetricRow
              label="Last run"
              value={reconciler.lastRunAt ? formatDiagnosticsTimestamp(reconciler.lastRunAt) : "-"}
            />
            <MetricRow
              label="Drift"
              value={reconciler.driftDetected === null ? "-" : reconciler.driftDetected ? "yes" : "no"}
            />
            <MetricRow
              label="Actions"
              value={reconciler.actionsTaken.length > 0 ? reconciler.actionsTaken.join(" | ") : "-"}
            />
            <MetricRow label="Detail" value={reconciler.detail ?? "-"} />
          </div>
        ))}
      </section>

      <section className="space-y-2 rounded border border-border/70 p-2" data-testid="decision-state-health-check">
        <p className="text-xs font-semibold text-foreground">Health Check</p>
        <MetricRow label="Run state" value={healthCheckState.runState} />
        <MetricRow label="Run ID" value={healthCheckState.currentRunId ?? "-"} />
        <MetricRow
          label="Reason"
          value={healthCheckState.lastTransitionReason ?? healthCheckState.latestResult?.overallHealth ?? "-"}
        />
        <div className="space-y-1 pt-1">
          {Object.entries(healthCheckState.probeStates).map(([probe, probeState]) => (
            <div key={probe} className="flex items-center justify-between gap-3 text-xs">
              <span className="text-muted-foreground">{probe}</span>
              <span className="font-mono text-foreground">{probeState.state}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2 rounded border border-border/70 p-2" data-testid="decision-state-transport">
        <p className="text-xs font-semibold text-foreground">Transport</p>
        <MetricRow label="REST avg" value={average(restDurations)} />
        <MetricRow label="FTP avg" value={average(ftpDurations)} />
        <div className="space-y-1 pt-1">
          {recentEffects.length === 0 ? (
            <p className="text-xs text-muted-foreground">No recent REST or FTP effects.</p>
          ) : (
            recentEffects.map(({ summary, effect }) => (
              <div
                key={`${summary.correlationId}-${effect.type}-${effect.label}`}
                className="rounded border border-border/60 bg-muted/20 p-2 text-xs"
              >
                <p className="font-medium text-foreground">
                  {effect.type === "REST" ? `${effect.method} ${effect.path}` : `${effect.operation} ${effect.path}`}
                </p>
                <p className="text-muted-foreground">
                  {effect.type === "REST"
                    ? `status ${effect.status ?? "unknown"}`
                    : `result ${effect.result ?? "unknown"}`}
                  {typeof effect.durationMs === "number" ? ` · ${effect.durationMs}ms` : ""}
                  {effect.error ? ` · ${effect.error}` : ""}
                </p>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="space-y-2 rounded border border-border/70 p-2" data-testid="decision-state-transitions">
        <p className="text-xs font-semibold text-foreground">Recent transitions</p>
        <div className="space-y-1">
          {[...decisionState.transitions, ...healthCheckState.transitions]
            .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
            .slice(0, 10)
            .map((entry) => (
              <div key={entry.id} className="rounded border border-border/60 bg-muted/20 p-2 text-xs">
                <p className="font-medium text-foreground">{entry.target}</p>
                <p className="text-muted-foreground">
                  {entry.from ?? "-"} to {entry.to} · {formatDiagnosticsTimestamp(entry.timestamp)}
                </p>
                {entry.reason ? <p className="text-muted-foreground">{entry.reason}</p> : null}
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}
