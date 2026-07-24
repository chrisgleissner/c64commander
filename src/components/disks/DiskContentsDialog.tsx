/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Play, Download, DiscAlbum } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { DiskDirectoryEntry } from "@/lib/disks/diskImage";

export type DiskEntryAction = "run" | "load" | "mountAndLoad";

export interface DiskContentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  diskName: string;
  entries: DiskDirectoryEntry[] | null;
  loading?: boolean;
  error?: string | null;
  /** Index of the entry currently launching (disables its row), or null. */
  busyIndex?: number | null;
  onAction: (action: DiskEntryAction, entry: DiskDirectoryEntry) => void;
}

const formatLoadAddress = (entry: DiskDirectoryEntry) =>
  entry.loadAddress != null ? `$${entry.loadAddress.toString(16).toUpperCase().padStart(4, "0")}` : null;

const launchReason = (entry: DiskDirectoryEntry): string | null => {
  if (entry.type !== "PRG") return `${entry.type} files can't be launched directly`;
  if (!entry.closed) return "Unclosed (splat) file — cannot launch";
  return null;
};

export function DiskContentsDialog({
  open,
  onOpenChange,
  diskName,
  entries,
  loading = false,
  error = null,
  busyIndex = null,
  onAction,
}: DiskContentsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent surface="confirmation" className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DiscAlbum className="h-5 w-5" aria-hidden />
            {diskName}
          </DialogTitle>
          <DialogDescription>
            {entries ? `${entries.length} file${entries.length === 1 ? "" : "s"}` : "Reading directory…"}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <p className="py-6 text-center text-sm text-muted-foreground" data-testid="disk-contents-loading">
            Reading directory…
          </p>
        )}

        {error && (
          <p className="py-4 text-sm text-destructive" role="alert" data-testid="disk-contents-error">
            {error}
          </p>
        )}

        {entries && entries.length === 0 && !loading && !error && (
          <p className="py-6 text-center text-sm text-muted-foreground">This disk has no files.</p>
        )}

        {entries && entries.length > 0 && (
          <ScrollArea className="max-h-[60vh] pr-2">
            <ul className="space-y-2" data-testid="disk-contents-list">
              {entries.map((entry) => {
                const reason = launchReason(entry);
                const disabled = reason != null || busyIndex === entry.index;
                const loadAddr = formatLoadAddress(entry);
                return (
                  <li
                    key={entry.index}
                    className="rounded-md border border-border p-3"
                    data-testid={`disk-entry-${entry.index}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium" title={entry.name}>
                            {entry.name || "(unnamed)"}
                          </span>
                          <Badge variant="secondary">{entry.type}</Badge>
                          {entry.locked && <Badge variant="outline">locked</Badge>}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {entry.blocks} blocks{loadAddr ? ` · ${loadAddr}` : ""}
                        </div>
                      </div>
                    </div>

                    {reason ? (
                      <p className="mt-2 text-xs text-muted-foreground">{reason}</p>
                    ) : (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="default"
                          disabled={disabled}
                          onClick={() => onAction("run", entry)}
                          data-testid={`disk-entry-run-${entry.index}`}
                        >
                          <Play className="mr-1 h-4 w-4" aria-hidden />
                          Run
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={disabled}
                          onClick={() => onAction("load", entry)}
                          data-testid={`disk-entry-load-${entry.index}`}
                        >
                          <Download className="mr-1 h-4 w-4" aria-hidden />
                          Load
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={disabled}
                          onClick={() => onAction("mountAndLoad", entry)}
                          data-testid={`disk-entry-mount-${entry.index}`}
                        >
                          Mount &amp; Load
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
