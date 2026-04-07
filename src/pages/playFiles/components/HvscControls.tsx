/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Capacitor } from "@capacitor/core";
import { Button } from "@/components/ui/button";

export type HvscControlsProps = {
  hvscInstalled: boolean;
  hvscInstalledVersion?: number | string | null;
  hvscAvailable: boolean;
  hvscUpdating: boolean;
  hvscInProgress: boolean;
  hvscCanIngest: boolean;
  hvscPhase: "idle" | "download" | "extract" | "index" | "ready" | "failed";
  hvscSummaryState: "idle" | "success" | "failure";
  hvscSummaryFilesExtracted?: number | null;
  hvscSummaryDurationMs?: number | null;
  hvscSummaryUpdatedAt?: string | null;
  hvscSummaryFailureLabel: string;
  hvscMetadataProgressLabel?: string | null;
  hvscMetadataUpdatedAt?: string | null;
  hvscIngestionTotalSongs: number;
  hvscIngestionIngestedSongs: number;
  hvscIngestionFailedSongs: number;
  hvscSonglengthSyntaxErrors: number;
  hvscActionLabel: string | null;
  hvscDownloadBytes: number | null;
  hvscDownloadElapsedMs: number | null | undefined;
  hvscInlineError: string | null;
  formatHvscDuration: (durationMs?: number | null) => string;
  formatHvscTimestamp: (value?: string | null) => string;
  formatBytes: (bytes?: number | null) => string;
  onInstall: () => void;
  onIngest: () => void;
  onCancel: () => void;
  onReset: () => void;
};

export const HvscControls = ({
  hvscInstalled,
  hvscInstalledVersion,
  hvscAvailable,
  hvscUpdating,
  hvscInProgress,
  hvscCanIngest,
  hvscPhase,
  hvscSummaryState,
  hvscSummaryFilesExtracted,
  hvscSummaryDurationMs,
  hvscSummaryUpdatedAt,
  hvscSummaryFailureLabel,
  hvscMetadataProgressLabel,
  hvscMetadataUpdatedAt,
  hvscIngestionTotalSongs,
  hvscIngestionIngestedSongs,
  hvscIngestionFailedSongs,
  hvscSonglengthSyntaxErrors,
  hvscActionLabel,
  hvscDownloadBytes,
  hvscDownloadElapsedMs,
  hvscInlineError,
  formatHvscDuration,
  formatHvscTimestamp,
  formatBytes,
  onInstall,
  onIngest,
  onCancel,
  onReset,
}: HvscControlsProps) => {
  const hvscLibraryReady = hvscInstalled || hvscIngestionTotalSongs > 0;
  const phaseLabel = (() => {
    switch (hvscPhase) {
      case "download":
        return "Downloading";
      case "extract":
        return "Extracting";
      case "index":
        return "Indexing";
      case "ready":
        return "Ready";
      case "failed":
        return "Failed";
      default:
        return "Idle";
    }
  })();

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
            {hvscInstalled
              ? `Installed version ${hvscInstalledVersion ?? "—"}`
              : "Download HVSC to cache the archive set, then ingest it to browse songs."}
          </p>
          <p className="text-[11px] text-muted-foreground">Status: {phaseLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <Button
            id="hvsc-download"
            variant="default"
            size="sm"
            onClick={onInstall}
            disabled={hvscUpdating || !hvscAvailable}
            className="whitespace-normal"
          >
            Download HVSC
          </Button>
          <Button
            id="hvsc-ingest"
            variant="outline"
            size="sm"
            onClick={onIngest}
            disabled={hvscUpdating || !hvscAvailable || !hvscCanIngest}
            className="whitespace-normal"
          >
            Ingest HVSC
          </Button>
          {(hvscSummaryState !== "idle" || hvscInlineError) && (
            <Button variant="ghost" size="sm" onClick={onReset} disabled={hvscUpdating} className="whitespace-normal">
              Reset status
            </Button>
          )}
          {hvscInProgress && (
            <Button
              variant="outline"
              size="sm"
              onClick={onCancel}
              className="whitespace-normal"
              data-testid="hvsc-stop"
            >
              Stop
            </Button>
          )}
        </div>
      </div>

      {hvscSummaryState !== "idle" && (
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs" data-testid="hvsc-summary">
          {hvscSummaryState === "success" ? (
            <div className="space-y-1">
              <p className="text-sm font-medium">HVSC ready</p>
              {hvscLibraryReady ? (
                <>
                  <p>
                    Indexed {hvscIngestionIngestedSongs} of {hvscIngestionTotalSongs} songs.
                  </p>
                  {hvscSonglengthSyntaxErrors > 0 && (
                    <p className="text-amber-700 dark:text-amber-400">
                      {hvscSonglengthSyntaxErrors} songlength entries had syntax errors and were ignored.
                    </p>
                  )}
                </>
              ) : (
                <p>HVSC archives are cached. Run Ingest HVSC to build the browseable library.</p>
              )}
              <p>Files extracted: {hvscSummaryFilesExtracted ?? "—"}</p>
              {hvscMetadataProgressLabel ? <p>{hvscMetadataProgressLabel}</p> : null}
              <p>Duration: {formatHvscDuration(hvscSummaryDurationMs)}</p>
              <p>Last updated: {formatHvscTimestamp(hvscSummaryUpdatedAt)}</p>
              {hvscMetadataUpdatedAt ? <p>Metadata updated: {formatHvscTimestamp(hvscMetadataUpdatedAt)}</p> : null}
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-sm font-medium">HVSC update failed</p>
              <p>{hvscSummaryFailureLabel}</p>
              {hvscIngestionFailedSongs > 0 && (
                <p>{hvscIngestionFailedSongs} songs could not be imported. Check diagnostics logs for details.</p>
              )}
            </div>
          )}
        </div>
      )}

      {!hvscAvailable && (
        <p className="text-xs text-muted-foreground">
          {Capacitor.getPlatform() === "web"
            ? "HVSC is not available in web browsers. Install the Android or iOS app to use HVSC."
            : "HVSC controls are available on native builds or when a mock bridge is enabled."}
        </p>
      )}
      {hvscAvailable && !hvscInstalled && !hvscUpdating && !hvscCanIngest && (
        <p className="text-xs text-muted-foreground">Download HVSC to cache the archive set before ingesting it.</p>
      )}

      {(hvscPhase === "download" || hvscPhase === "extract" || hvscPhase === "index") && (
        <div className="space-y-1" data-testid="hvsc-progress">
          <p className="text-xs text-muted-foreground">{hvscActionLabel || "Processing HVSC…"}</p>
          <p className="text-[11px] text-muted-foreground" data-testid="hvsc-download-bytes">
            {hvscDownloadBytes
              ? `${(hvscDownloadBytes / 1024 / 1024).toFixed(1)} MB${hvscDownloadElapsedMs ? ` · ${formatHvscDuration(hvscDownloadElapsedMs)}` : ""}`
              : "—"}
          </p>
        </div>
      )}

      {hvscInlineError && <p className="text-xs text-destructive">{hvscInlineError}</p>}
      {hvscInstalled && hvscAvailable ? (
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">
            Browse and add HVSC songs from the shared “Add items” source chooser.
          </p>
        </div>
      ) : null}
    </div>
  );
};
