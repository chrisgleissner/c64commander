/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

export type HvscControlsProps = {
  hvscInstalled: boolean;
  hvscInstalledVersion?: number | string | null;
  hvscAvailable: boolean;
  hvscUpdating: boolean;
  hvscInProgress: boolean;
  hvscCanIngest: boolean;
  hvscPhase: 'idle' | 'download' | 'extract' | 'index' | 'ready' | 'failed';
  hvscSummaryState: 'idle' | 'success' | 'failure';
  hvscSummaryFilesExtracted?: number | null;
  hvscSummaryDurationMs?: number | null;
  hvscSummaryUpdatedAt?: string | null;
  hvscSummaryFailureLabel: string;
  hvscIngestionTotalSongs: number;
  hvscIngestionIngestedSongs: number;
  hvscIngestionFailedSongs: number;
  hvscSonglengthSyntaxErrors: number;
  hvscActionLabel: string | null;
  hvscStage: string | null;
  hvscDownloadPercent: number | null | undefined;
  hvscDownloadBytes: number | null;
  hvscDownloadTotalBytes: number | null;
  hvscDownloadElapsedMs: number | null | undefined;
  hvscDownloadStatus: string;
  hvscExtractionPercent: number | null | undefined;
  hvscExtractionTotalFiles: number | null;
  hvscExtractionElapsedMs: number | null | undefined;
  hvscExtractionStatus: string;
  hvscCurrentFile: string | null;
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
  hvscIngestionTotalSongs,
  hvscIngestionIngestedSongs,
  hvscIngestionFailedSongs,
  hvscSonglengthSyntaxErrors,
  hvscActionLabel,
  hvscStage,
  hvscDownloadPercent,
  hvscDownloadBytes,
  hvscDownloadTotalBytes,
  hvscDownloadElapsedMs,
  hvscDownloadStatus,
  hvscExtractionPercent,
  hvscExtractionTotalFiles,
  hvscExtractionElapsedMs,
  hvscExtractionStatus,
  hvscCurrentFile,
  hvscInlineError,
  formatHvscDuration,
  formatHvscTimestamp,
  formatBytes,
  onInstall,
  onIngest,
  onCancel,
  onReset,
}: HvscControlsProps) => {
  const phaseLabel = (() => {
    switch (hvscPhase) {
      case 'download':
        return 'Downloading';
      case 'extract':
        return 'Extracting';
      case 'index':
        return 'Indexing';
      case 'ready':
        return 'Ready';
      case 'failed':
        return 'Failed';
      default:
        return 'Idle';
    }
  })();

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-4" data-testid="hvsc-controls">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">HVSC</p>
          <p className="text-xs text-muted-foreground">
            {hvscInstalled
              ? `Installed version ${hvscInstalledVersion ?? '—'}`
              : 'Download HVSC to browse the SID collection.'}
          </p>
          <p className="text-[11px] text-muted-foreground">Status: {phaseLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <Button
            variant="default"
            size="sm"
            onClick={onInstall}
            disabled={hvscUpdating || !hvscAvailable}
            className="whitespace-normal"
          >
            Download HVSC
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onIngest}
            disabled={hvscUpdating || !hvscAvailable || !hvscCanIngest}
            className="whitespace-normal"
          >
            Ingest HVSC
          </Button>
          {(hvscSummaryState !== 'idle' || hvscInlineError) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onReset}
              disabled={hvscUpdating}
              className="whitespace-normal"
            >
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

      {hvscSummaryState !== 'idle' && (
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs" data-testid="hvsc-summary">
          {hvscSummaryState === 'success' ? (
            <div className="space-y-1">
              <p className="text-sm font-medium">HVSC downloaded successfully</p>
              <p>Ingested {hvscIngestionIngestedSongs} of {hvscIngestionTotalSongs} songs.</p>
              {hvscSonglengthSyntaxErrors > 0 && (
                <p className="text-amber-700 dark:text-amber-400">
                  {hvscSonglengthSyntaxErrors} songlength entries had syntax errors and were ignored.
                </p>
              )}
              <p>Files extracted: {hvscSummaryFilesExtracted ?? '—'}</p>
              <p>Duration: {formatHvscDuration(hvscSummaryDurationMs)}</p>
              <p>Last updated: {formatHvscTimestamp(hvscSummaryUpdatedAt)}</p>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-sm font-medium">HVSC download failed</p>
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
          HVSC controls are available on native builds or when a mock bridge is enabled.
        </p>
      )}
      {hvscAvailable && !hvscInstalled && !hvscUpdating && !hvscCanIngest && (
        <p className="text-xs text-muted-foreground">
          Download HVSC to cache the archives before ingesting.
        </p>
      )}

      {(hvscPhase === 'download' || hvscPhase === 'extract' || hvscPhase === 'index') && (
        <div className="space-y-2" data-testid="hvsc-progress">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{hvscActionLabel || 'Processing HVSC…'}</span>
            <span>{hvscStage ? hvscStage : '—'}</span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Download</span>
              <span>{hvscDownloadPercent !== null && hvscDownloadPercent !== undefined ? `${Math.round(hvscDownloadPercent)}%` : '—'}</span>
            </div>
            <Progress value={hvscDownloadPercent ?? undefined} />
            <div className="flex items-center justify-between text-[11px] text-muted-foreground" data-testid="hvsc-download-bytes">
              <span>Downloaded: {formatBytes(hvscDownloadBytes)}</span>
              <span>Total: {formatBytes(hvscDownloadTotalBytes)}</span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground" data-testid="hvsc-download-elapsed">
              <span>Elapsed: {formatHvscDuration(hvscDownloadElapsedMs)}</span>
              <span>Status: {hvscDownloadStatus}</span>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Extraction + indexing</span>
              <span>{hvscExtractionPercent !== null && hvscExtractionPercent !== undefined ? `${Math.round(hvscExtractionPercent)}%` : '—'}</span>
            </div>
            <Progress value={hvscExtractionPercent ?? undefined} />
            <div className="flex items-center justify-between text-[11px] text-muted-foreground" data-testid="hvsc-extraction-files">
              <span>Files: {hvscSummaryFilesExtracted ?? '—'}</span>
              <span>Total: {hvscExtractionTotalFiles ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground" data-testid="hvsc-extraction-elapsed">
              <span>Elapsed: {formatHvscDuration(hvscExtractionElapsedMs)}</span>
              <span>Status: {hvscExtractionStatus}</span>
            </div>
          </div>
          {hvscCurrentFile && (
            <p className="text-[11px] text-muted-foreground break-words whitespace-normal">Current: {hvscCurrentFile}</p>
          )}
        </div>
      )}

      {hvscInlineError && (
        <p className="text-xs text-destructive">{hvscInlineError}</p>
      )}
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
