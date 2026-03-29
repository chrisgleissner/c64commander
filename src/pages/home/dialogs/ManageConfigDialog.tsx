/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState } from "react";
import {
  AppDialog,
  AppDialogBody,
  AppDialogContent,
  AppDialogDescription,
  AppDialogFooter,
  AppDialogHeader,
  AppDialogTitle,
  AppSheet,
  AppSheetBody,
  AppSheetContent,
  AppSheetDescription,
  AppSheetFooter,
  AppSheetHeader,
  AppSheetTitle,
} from "@/components/ui/app-surface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ConfigItem {
  id: string;
  name: string;
  savedAt: string;
}

interface ManageConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  configs: ConfigItem[];
  onRename: (id: string, newName: string) => void;
  onDelete: (id: string) => void;
}

export function ManageConfigDialog({ open, onOpenChange, configs, onRename, onDelete }: ManageConfigDialogProps) {
  const [renameTarget, setRenameTarget] = useState<ConfigItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ConfigItem | null>(null);

  const openRenameDialog = (config: ConfigItem) => {
    setRenameTarget(config);
    setRenameValue(config.name);
  };

  return (
    <>
      <AppSheet open={open} onOpenChange={onOpenChange}>
        <AppSheetContent className="overflow-hidden p-0" data-testid="manage-configs-sheet">
          <AppSheetHeader>
            <AppSheetTitle>Manage App Configs</AppSheetTitle>
            <AppSheetDescription>Rename or delete saved configurations.</AppSheetDescription>
          </AppSheetHeader>
          <AppSheetBody className="px-4 py-4 sm:px-6">
            <div className="space-y-3">
              {configs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No saved configurations yet.</p>
              ) : (
                configs.map((config) => (
                  <div key={config.id} className="space-y-3 rounded-lg border border-border p-3">
                    <div className="space-y-1">
                      <p className="font-medium">{config.name}</p>
                      <p className="text-xs text-muted-foreground">{new Date(config.savedAt).toLocaleString()}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => openRenameDialog(config)}>
                        Rename
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => setDeleteTarget(config)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </AppSheetBody>
          <AppSheetFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </AppSheetFooter>
        </AppSheetContent>
      </AppSheet>

      <AppDialog open={Boolean(renameTarget)} onOpenChange={(nextOpen) => !nextOpen && setRenameTarget(null)}>
        <AppDialogContent data-testid="manage-configs-rename-dialog">
          <AppDialogHeader>
            <AppDialogTitle>Rename config</AppDialogTitle>
            <AppDialogDescription>Update the saved configuration name.</AppDialogDescription>
          </AppDialogHeader>
          <AppDialogBody>
            <Input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
          </AppDialogBody>
          <AppDialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!renameTarget) return;
                onRename(renameTarget.id, renameValue.trim() || renameTarget.name);
                setRenameTarget(null);
              }}
            >
              Save
            </Button>
          </AppDialogFooter>
        </AppDialogContent>
      </AppDialog>

      <AppDialog open={Boolean(deleteTarget)} onOpenChange={(nextOpen) => !nextOpen && setDeleteTarget(null)}>
        <AppDialogContent data-testid="manage-configs-delete-dialog">
          <AppDialogHeader>
            <AppDialogTitle>Delete config?</AppDialogTitle>
            <AppDialogDescription>
              {deleteTarget ? `Remove "${deleteTarget.name}" from saved app configs.` : "Remove this saved app config."}
            </AppDialogDescription>
          </AppDialogHeader>
          <AppDialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!deleteTarget) return;
                onDelete(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              Delete
            </Button>
          </AppDialogFooter>
        </AppDialogContent>
      </AppDialog>
    </>
  );
}
