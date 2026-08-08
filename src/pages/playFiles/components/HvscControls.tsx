/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Button } from "@/components/ui/button";
import type { HvscPreparationPhase, HvscPreparationState } from "@/lib/hvsc";
import type { HvscStageId } from "@/lib/hvsc/hvscStageModel";
import { HvscStageSteps } from "./HvscStageSteps";

/** How long the finished steps stay on screen, so the completion is actually seen. */
const COMPLETION_HOLD_MS = 4000;

export type HvscControlsProps = {
  hvscInstalledVersion?: number | string | null;
  hvscAvailable: boolean;
  hvscUpdating: boolean;
  hvscInProgress: boolean;
  hvscCanIngest: boolean;
  hvscPreparationState: HvscPreparationState;
  hvscPreparationStatusLabel: string;
  hvscStage: string | null;
  hvscStageStep?: HvscStageId | null;
  hvscStagePercent: number | null;
  hvscStageDone?: number | null;
  hvscStageTotal?: number | null;
  hvscPreparationFailedPhase?: HvscPreparationPhase;
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
  onInstall: () => void;
  onIngest: () => void;
  onCancel: () => void;
  onReindex: () => void;
  onReset: () => void;
};

export const HvscControls = ({
  hvscInstalledVersion,
  hvscAvailable,
  hvscUpdating,
  hvscInProgress,
  hvscCanIngest,
  hvscPreparationState,
  hvscPreparationStatusLabel,
  hvscStage,
  hvscStageStep = null,
  hvscStagePercent,
  hvscStageDone = null,
  hvscStageTotal = null,
  hvscPreparationFailedPhase = null,
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
  onInstall,
  onIngest,
  onCancel,
  onReindex,
  onReset,
}: HvscControlsProps) => {
  const readyToUseLabel = "Ready to use: Add items -> HVSC.";
  const isReady = hvscPreparationState === "READY";
  const isError = hvscPreparationState === "ERROR";
  const working = hvscPreparationState !== "NOT_PRESENT" && hvscPreparationState !== "READY";

  // Keep the steps up for a moment once everything is done. The bar this replaced hid itself the
  // instant the state left DOWNLOADING/INGESTING, so the completion the user had been waiting for was
  // the one frame never rendered — measured on the device, it went from 73% straight to gone.
  const [justCompleted, setJustCompleted] = useState(false);
  const wasWorkingRef = useRef(false);
  useEffect(() => {
    if (working) {
      wasWorkingRef.current = true;
      setJustCompleted(false);
      return;
    }
    if (!wasWorkingRef.current || hvscPreparationState !== "READY") return;
    wasWorkingRef.current = false;
    setJustCompleted(true);
    const timer = window.setTimeout(() => setJustCompleted(false), COMPLETION_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [working, hvscPreparationState]);

  // Two different questions, which used to share one answer. The steps are shown whenever there is
  // something to show, including the moment everything finishes and after a failure; Stop belongs
  // only to work that is actually running. Conflating them left Stop on screen after a cancel.
  const isPreparing = working || justCompleted;
  const isRunning = hvscInProgress || hvscPreparationState === "DOWNLOADING" || hvscPreparationState === "INGESTING";
  const isDownloaded = hvscPreparationState === "DOWNLOADED";
  const canDownload = hvscAvailable && !hvscUpdating;
  const canIngest = hvscAvailable && hvscCanIngest && !hvscUpdating;

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

        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {/* "Download" and "Ingest", not "Download HVSC" and "Ingest HVSC". The heading two
              lines above says HVSC and nothing else in this block does anything else, so the
              repeat bought nothing and cost the width: on a 320px screen "Download HVSC" ran
              past the edge of its button. The accessible names keep the noun, because a
              screen reader reaching the button by name has no heading for context. */}
          <Button
            id="hvsc-download"
            variant="default"
            size="sm"
            onClick={onInstall}
            disabled={!canDownload}
            aria-label="Download HVSC"
          >
            Download
          </Button>
          <Button
            id="hvsc-ingest"
            variant="outline"
            size="sm"
            onClick={onIngest}
            disabled={!canIngest}
            aria-label="Ingest HVSC"
          >
            Ingest
          </Button>
          {isRunning ? (
            <Button variant="outline" size="sm" onClick={onCancel} data-testid="hvsc-stop">
              Stop
            </Button>
          ) : null}
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
            </div>
            <HvscStageSteps
              state={hvscPreparationState}
              stage={hvscStage}
              step={hvscStageStep}
              failedPhase={hvscPreparationFailedPhase}
              stagePercent={hvscStagePercent}
              stageDone={hvscStageDone}
              stageTotal={hvscStageTotal}
              detailLabel={hvscPreparationThroughputLabel}
            />
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
        {hvscMetadataUpdatedAt ? <p>Song details updated: {formatHvscTimestamp(hvscMetadataUpdatedAt)}</p> : null}
      </div>

      {!hvscAvailable && (
        <p className="text-xs text-muted-foreground">
          {Capacitor.getPlatform() === "web"
            ? "HVSC is not available in web browsers. Install the Android or iOS app to use HVSC."
            : "HVSC controls are available on native builds or when a mock bridge is enabled."}
        </p>
      )}

      {hvscAvailable && !hvscInstalledVersion && !hvscUpdating && !hvscCanIngest ? (
        <p className="text-xs text-muted-foreground">Download HVSC to cache the archive set before ingesting it.</p>
      ) : null}

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
