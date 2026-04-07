/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Capacitor } from "@capacitor/core";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { HvscPreparationState } from "@/lib/hvsc";

export type HvscControlsProps = {
  hvscInstalledVersion?: number | string | null;
  hvscAvailable: boolean;
  hvscUpdating: boolean;
  hvscCanIngest: boolean;
  hvscPreparationState: HvscPreparationState;
  hvscPreparationStatusLabel: string;
  hvscPreparationProgressPercent: number | null;
  hvscPreparationThroughputLabel: string | null;
  hvscPreparationErrorReason: string | null;
  hvscReadySongCount: number;
  hvscSummaryFilesExtracted?: number | null;
  hvscSummaryDurationMs?: number | null;
  hvscSummaryUpdatedAt?: string | null;
  hvscMetadataProgressLabel?: string | null;
  hvscMetadataUpdatedAt?: string | null;
  hvscSonglengthSyntaxErrors: number;
  formatHvscDuration: (durationMs?: number | null) => string;
  formatHvscTimestamp: (value?: string | null) => string;
  onReindex: () => void;
  onReset: () => void;
};

export const HvscControls = ({
  hvscInstalledVersion,
  hvscAvailable,
  hvscUpdating,
  hvscCanIngest,
  hvscPreparationState,
  hvscPreparationStatusLabel,
  hvscPreparationProgressPercent,
  hvscPreparationThroughputLabel,
  hvscPreparationErrorReason,
  hvscReadySongCount,
  hvscSummaryFilesExtracted,
  hvscSummaryDurationMs,
  hvscSummaryUpdatedAt,
  hvscMetadataProgressLabel,
  hvscMetadataUpdatedAt,
  hvscSonglengthSyntaxErrors,
  formatHvscDuration,
  formatHvscTimestamp,
  onReindex,
  onReset,
}: HvscControlsProps) => {
  const readyToUseLabel = "Ready to use: Add items -> HVSC.";
  const isReady = hvscPreparationState === "READY";
  const isError = hvscPreparationState === "ERROR";
  const isPreparing = hvscPreparationState === "DOWNLOADING" || hvscPreparationState === "INGESTING";
  const isDownloaded = hvscPreparationState === "DOWNLOADED";

  return (
    <div
      id="hvsc-controls"
      className="bg-card border border-border rounded-xl p-4 space-y-4"
      data-testid="hvsc-controls"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">HVSC</p>
          <p className="text-xs text-muted-foreground">
            {hvscInstalledVersion
              ? `Installed version ${hvscInstalledVersion}`
              : "HVSC will be prepared automatically the first time you choose Add items -> HVSC."}
          </p>
          <p className="text-[11px] text-muted-foreground">Status: {hvscPreparationStatusLabel}</p>
        </div>
      </div>

      <div
        className="rounded-lg border border-border bg-muted/30 px-3 py-3 text-xs space-y-2"
        data-testid="hvsc-summary"
      >
        {isReady ? <p className="text-sm font-medium">HVSC ready</p> : null}
        {isError ? <p className="text-sm font-medium">HVSC preparation failed</p> : null}
        {!isReady && !isError ? <p className="text-sm font-medium">HVSC summary</p> : null}

        {isReady ? (
          <>
            <p className="text-sm font-medium text-foreground" data-testid="hvsc-ready-source-hint">
              {readyToUseLabel}
            </p>
            <p>{hvscReadySongCount.toLocaleString()} songs indexed.</p>
          </>
        ) : null}

        {isDownloaded ? <p>The archive download is complete. Advanced reindex uses the cached archive.</p> : null}

        {isPreparing ? (
          <div className="space-y-2" data-testid="hvsc-progress">
            <div className="flex items-center justify-between gap-2">
              <span>{hvscPreparationStatusLabel}</span>
              <span>{Math.round(hvscPreparationProgressPercent ?? 0)}%</span>
            </div>
            <Progress value={hvscPreparationProgressPercent ?? 0} />
            {hvscPreparationThroughputLabel ? (
              <p className="text-[11px] text-muted-foreground" data-testid="hvsc-download-bytes">
                {hvscPreparationThroughputLabel}
              </p>
            ) : null}
          </div>
        ) : null}

        {hvscPreparationErrorReason ? <p className="text-destructive">{hvscPreparationErrorReason}</p> : null}
        {hvscSonglengthSyntaxErrors > 0 ? (
          <p className="text-amber-700 dark:text-amber-400">
            {hvscSonglengthSyntaxErrors} songlength entries had syntax errors and were ignored.
          </p>
        ) : null}
        <p>Files extracted: {hvscSummaryFilesExtracted ?? "—"}</p>
        {hvscMetadataProgressLabel ? <p>{hvscMetadataProgressLabel}</p> : null}
        <p>Duration: {formatHvscDuration(hvscSummaryDurationMs)}</p>
        <p>Last updated: {formatHvscTimestamp(hvscSummaryUpdatedAt)}</p>
        {hvscMetadataUpdatedAt ? <p>Metadata updated: {formatHvscTimestamp(hvscMetadataUpdatedAt)}</p> : null}
      </div>

      {!hvscAvailable && (
        <p className="text-xs text-muted-foreground">
          {Capacitor.getPlatform() === "web"
            ? "HVSC is not available in web browsers. Install the Android or iOS app to use HVSC."
            : "HVSC controls are available on native builds or when a mock bridge is enabled."}
        </p>
      )}

      {hvscAvailable ? (
        <div className="rounded-lg border border-dashed border-border p-3 space-y-2">
          <p className="text-xs font-medium text-foreground">Advanced</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              id="hvsc-reindex"
              variant="outline"
              size="sm"
              onClick={onReindex}
              disabled={hvscUpdating || !hvscCanIngest}
            >
              Reindex HVSC
            </Button>
            <Button id="hvsc-reset" variant="ghost" size="sm" onClick={onReset} disabled={hvscUpdating}>
              Reset HVSC
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
};
