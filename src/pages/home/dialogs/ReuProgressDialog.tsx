/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import {
  AppDialog,
  AppDialogBody,
  AppDialogContent,
  AppDialogDescription,
  AppDialogHeader,
  AppDialogTitle,
} from "@/components/ui/app-surface";
import { Progress } from "@/components/ui/progress";
import type { ReuProgressState } from "@/lib/reu/reuSnapshotTypes";

interface ReuProgressDialogProps {
  open: boolean;
  progress: ReuProgressState | null;
}

export function ReuProgressDialog({ open, progress }: ReuProgressDialogProps) {
  if (!progress) return null;

  return (
    <AppDialog open={open} onOpenChange={() => undefined}>
      <AppDialogContent hideClose data-testid="reu-progress-dialog">
        <AppDialogHeader>
          <AppDialogTitle>{progress.title}</AppDialogTitle>
          <AppDialogDescription>{progress.description}</AppDialogDescription>
        </AppDialogHeader>
        <AppDialogBody className="space-y-4">
          <Progress value={typeof progress.progress === "number" ? progress.progress : undefined} />
          <p className="text-sm text-muted-foreground">This can take around 30 seconds.</p>
        </AppDialogBody>
      </AppDialogContent>
    </AppDialog>
  );
}
