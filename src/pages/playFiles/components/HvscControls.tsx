/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { ActionLogIcon } from '@radix-ui/react-icons';
import { ArrowUp, FolderOpen, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { getParentPath } from '@/lib/playback/localFileBrowser';
import type { LocalPlayFile, PlaySource } from '@/lib/playback/playbackRouter';

export type HvscSong = {
  id: number;
  virtualPath: string;
  fileName: string;
  durationSeconds?: number | null;
};

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
  hvscFolderFilter: string;
  hvscVisibleFolders: string[];
  hvscSongs: HvscSong[];
  selectedHvscFolder: string;
  hvscRootPath: string;
  formatHvscDuration: (durationMs?: number | null) => string;
  formatHvscTimestamp: (value?: string | null) => string;
  formatBytes: (bytes?: number | null) => string;
  onInstall: () => void;
  onIngest: () => void;
  onCancel: () => void;
  onReset: () => void;
  onFolderFilterChange: (value: string) => void;
  onSelectFolder: (folder: string) => void;
  onPlayFolder: (folder: string) => void;
  onPlayEntry: (entry: { source: PlaySource; name: string; path: string; file: LocalPlayFile; durationMs?: number; sourceId?: string | null }) => void;
  onAddToPlaylist: (entry: { source: PlaySource; name: string; path: string; file: LocalPlayFile; durationMs?: number; sourceId?: string | null }) => void;
  buildHvscFile: (song: HvscSong) => LocalPlayFile;
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
  hvscFolderFilter,
  hvscVisibleFolders,
  hvscSongs,
  selectedHvscFolder,
  hvscRootPath,
  formatHvscDuration,
  formatHvscTimestamp,
  formatBytes,
  onInstall,
  onIngest,
  onCancel,
  onReset,
  onFolderFilterChange,
  onSelectFolder,
  onPlayFolder,
  onPlayEntry,
  onAddToPlaylist,
  buildHvscFile,
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
          <p className="text-sm font-medium">HVSC library</p>
          <p className="text-xs text-muted-foreground">
            {hvscInstalled
              ? `Installed version ${hvscInstalledVersion ?? '—'}`
              : 'Download the HVSC library to browse the SID collection.'}
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
              <p>Files extracted: {hvscSummaryFilesExtracted ?? '—'}</p>
              <p>Duration: {formatHvscDuration(hvscSummaryDurationMs)}</p>
              <p>Last updated: {formatHvscTimestamp(hvscSummaryUpdatedAt)}</p>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-sm font-medium">HVSC download failed</p>
              <p>{hvscSummaryFailureLabel}</p>
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

      {hvscInstalled && hvscAvailable && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Browse HVSC folders</p>
              <p className="text-xs text-muted-foreground">Play SID files from the collection.</p>
            </div>
            <Button
              variant="default"
              size="sm"
              onClick={() => onPlayFolder(selectedHvscFolder)}
              disabled={hvscUpdating}
            >
              <Play className="h-4 w-4 mr-1" />
              Play folder
            </Button>
          </div>

          <Input
            placeholder="Filter folders…"
            value={hvscFolderFilter}
            onChange={(event) => onFolderFilterChange(event.target.value)}
          />

          {selectedHvscFolder !== '/' && (
            <div className="flex items-center gap-2 pb-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSelectFolder(getParentPath(selectedHvscFolder))}
                title="Go up"
              >
                <ArrowUp className="h-4 w-4 mr-1" />
                Up
              </Button>
              <span className="text-sm font-medium break-all">{selectedHvscFolder}</span>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            {hvscVisibleFolders.slice(0, 24).map((folder) => (
              <div key={folder} className="flex items-center gap-2 min-w-0">
                <Button
                  variant={folder === selectedHvscFolder ? 'secondary' : 'outline'}
                  size="sm"
                  className="flex-1 justify-start min-w-0 whitespace-normal items-start"
                  onClick={() => onSelectFolder(folder)}
                >
                  <FolderOpen className="h-4 w-4 mr-1 shrink-0" />
                  <span className="break-words whitespace-normal">{folder}</span>
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  className="shrink-0"
                  onClick={() => onPlayFolder(folder)}
                  disabled={hvscUpdating}
                >
                  <Play className="h-4 w-4 mr-1" />
                  Play
                </Button>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            {hvscSongs.length === 0 && (
              <p className="text-xs text-muted-foreground">No songs in this folder.</p>
            )}
            {hvscSongs.slice(0, 80).map((song) => (
              <ContextMenu key={song.id}>
                <ContextMenuTrigger>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium break-words whitespace-normal">{song.fileName}</p>
                      <p className="text-xs text-muted-foreground break-words whitespace-normal">{song.virtualPath}</p>
                      {song.durationSeconds ? (
                        <p className="text-xs text-muted-foreground">{formatHvscDuration(song.durationSeconds * 1000)}</p>
                      ) : null}
                    </div>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPlayEntry({
                          source: 'hvsc',
                          name: song.fileName,
                          path: song.virtualPath,
                          file: buildHvscFile(song),
                          durationMs: song.durationSeconds ? song.durationSeconds * 1000 : undefined,
                          sourceId: hvscRootPath,
                        });
                      }}
                      disabled={hvscUpdating}
                    >
                      <Play className="h-4 w-4 mr-1" />
                      Play
                    </Button>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    onClick={() =>
                      onAddToPlaylist({
                        source: 'hvsc',
                        name: song.fileName,
                        path: song.virtualPath,
                        file: buildHvscFile(song),
                        durationMs: song.durationSeconds ? song.durationSeconds * 1000 : undefined,
                        sourceId: hvscRootPath,
                      })
                    }
                  >
                    Add to playlist
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
