/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import type { MemoryRange, SnapshotType } from "@/lib/snapshot/snapshotTypes";
import { SNAPSHOT_TYPE_LIST } from "@/lib/snapshot/snapshotTypes";

interface SaveRamDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (type: SnapshotType, customRanges?: MemoryRange[]) => void;
  isSaving: boolean;
}

const HEX_RE = /^[0-9a-fA-F]{1,4}$/;

const parseHexAddress = (raw: string): number | null => {
  const cleaned = raw.trim().replace(/^\$/, "");
  if (!HEX_RE.test(cleaned)) return null;
  return parseInt(cleaned, 16);
};

export function SaveRamDialog({ open, onOpenChange, onSave, isSaving }: SaveRamDialogProps) {
  const [showCustom, setShowCustom] = useState(false);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const handleClose = () => {
    setShowCustom(false);
    setCustomStart("");
    setCustomEnd("");
    onOpenChange(false);
  };

  const handleTypeSelect = (type: SnapshotType) => {
    if (type === "custom") {
      setShowCustom(true);
      return;
    }
    onSave(type);
    handleClose();
  };

  const handleCustomSave = () => {
    const start = parseHexAddress(customStart);
    const end = parseHexAddress(customEnd);
    if (start === null || end === null) {
      toast({ title: "Invalid address", description: "Enter hex addresses like $0400 or 0400." });
      return;
    }
    if (end < start) {
      toast({ title: "Invalid range", description: "End address must be ≥ start address." });
      return;
    }
    const length = end - start + 1;
    onSave("custom", [{ start, length }]);
    handleClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent data-testid="save-ram-dialog">
        <DialogHeader>
          <DialogTitle>Save RAM</DialogTitle>
          <DialogDescription>Choose the memory region to snapshot.</DialogDescription>
        </DialogHeader>

        {!showCustom ? (
          <div className="space-y-2" data-testid="save-ram-type-list">
            {SNAPSHOT_TYPE_LIST.map((config) => (
              <button
                key={config.type}
                data-testid={`save-ram-type-${config.type}`}
                className="w-full text-left rounded-lg border border-border bg-card hover:bg-accent hover:text-accent-foreground px-4 py-3 transition-colors disabled:opacity-50"
                onClick={() => void handleTypeSelect(config.type)}
                disabled={isSaving}
              >
                <div className="font-semibold text-sm">{config.label}</div>
                {config.type !== "custom" && (
                  <div className="text-xs text-muted-foreground mt-0.5">{config.rangeDisplay}</div>
                )}
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-3" data-testid="save-ram-custom-form">
            <p className="text-sm text-muted-foreground">Enter the start and end addresses in hex (e.g. $0400).</p>
            <div className="flex gap-2 items-center">
              <Input
                placeholder="Start (e.g. $0400)"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                data-testid="save-ram-custom-start"
              />
              <span className="text-muted-foreground">–</span>
              <Input
                placeholder="End (e.g. $07E7)"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                data-testid="save-ram-custom-end"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {showCustom ? (
            <>
              <Button variant="outline" onClick={() => setShowCustom(false)} disabled={isSaving}>
                Back
              </Button>
              <Button onClick={handleCustomSave} disabled={isSaving} data-testid="save-ram-custom-confirm">
                {isSaving ? "Saving…" : "Save"}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={handleClose} disabled={isSaving}>
              Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
