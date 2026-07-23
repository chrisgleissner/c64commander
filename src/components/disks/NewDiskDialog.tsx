/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useMemo, useState } from "react";
import { HardDriveDownload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CREATE_DISK_KINDS,
  DISK_LABEL_MAX,
  buildCreateDiskPlan,
  type CreateDiskArgs,
  type CreateDiskKind,
} from "@/lib/disks/createDisk";
import type { CreateDiskResult } from "@/lib/c64api";

export interface NewDiskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Creates the disk on the device (defaults to the live API). */
  createDisk: (args: CreateDiskArgs) => Promise<CreateDiskResult>;
  /** Called after a successful create, e.g. to mount + add to the library. */
  onCreated?: (result: CreateDiskResult) => void | Promise<void>;
  /** Prefilled storage folder (e.g. the folder the user is browsing). */
  defaultFolder?: string;
}

const KIND_LABEL: Record<CreateDiskKind, string> = {
  d64: "D64 (1541)",
  d71: "D71 (1571)",
  d81: "D81 (1581)",
  dnp: "DNP (CMD native)",
};

const needsTracks = (kind: CreateDiskKind) => kind === "d64" || kind === "dnp";

export function NewDiskDialog({
  open,
  onOpenChange,
  createDisk,
  onCreated,
  defaultFolder = "/USB0",
}: NewDiskDialogProps) {
  const [kind, setKind] = useState<CreateDiskKind>("d64");
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [folder, setFolder] = useState(defaultFolder);
  const [tracks, setTracks] = useState("35");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const args = useMemo<CreateDiskArgs>(
    () => ({
      folder,
      name,
      kind,
      diskLabel: label || undefined,
      tracks: needsTracks(kind) ? Number(tracks) : undefined,
    }),
    [folder, name, kind, label, tracks],
  );

  const previewError = useMemo(() => {
    if (!name.trim()) return null;
    try {
      buildCreateDiskPlan(args);
      return null;
    } catch (err) {
      return (err as Error).message;
    }
  }, [args, name]);

  const reset = () => {
    setKind("d64");
    setName("");
    setLabel("");
    setFolder(defaultFolder);
    setTracks("35");
    setError(null);
    setBusy(false);
  };

  const handleSubmit = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await createDisk(args);
      await onCreated?.(result);
      onOpenChange(false);
      reset();
    } catch (err) {
      setError((err as Error).message || "Could not create the disk.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) {
          reset();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent surface="confirmation">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardDriveDownload className="h-5 w-5" aria-hidden />
            New disk
          </DialogTitle>
          <DialogDescription>Create a formatted blank image on the device, then mount it.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-disk-type">Type</Label>
            <Select value={kind} onValueChange={(value) => setKind(value as CreateDiskKind)}>
              <SelectTrigger id="new-disk-type" data-testid="new-disk-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CREATE_DISK_KINDS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {KIND_LABEL[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-disk-name">File name</Label>
            <Input
              id="new-disk-name"
              data-testid="new-disk-name"
              value={name}
              placeholder={`my-disk.${kind}`}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-disk-label">Disk label (max {DISK_LABEL_MAX})</Label>
            <Input
              id="new-disk-label"
              data-testid="new-disk-label"
              value={label}
              maxLength={DISK_LABEL_MAX}
              placeholder="defaults to the file name"
              onChange={(event) => setLabel(event.target.value)}
              autoComplete="off"
            />
          </div>

          {needsTracks(kind) && (
            <div className="space-y-2">
              <Label htmlFor="new-disk-tracks">Tracks {kind === "d64" ? "(35–41)" : "(1–255, required)"}</Label>
              <Input
                id="new-disk-tracks"
                data-testid="new-disk-tracks"
                inputMode="numeric"
                value={tracks}
                onChange={(event) => setTracks(event.target.value)}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="new-disk-folder">Storage folder</Label>
            <Input
              id="new-disk-folder"
              data-testid="new-disk-folder"
              value={folder}
              placeholder="/USB0"
              onChange={(event) => setFolder(event.target.value)}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Use a real device folder (e.g. USB0). The top-level / is virtual and cannot hold files.
            </p>
          </div>

          {(error || previewError) && (
            <p className="text-sm text-destructive" role="alert" data-testid="new-disk-error">
              {error ?? previewError}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={busy || !name.trim() || previewError != null}
            data-testid="new-disk-create"
          >
            {busy ? "Creating…" : "Create & mount"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
