/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DeviceLessChoices } from "@/components/appMode/DeviceLessChoices";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { enterSidPlayer, switchToDemoMode, switchToFullApp } from "@/lib/appMode/appModeTransitions";
import { MODE_COPY } from "@/lib/appMode/copy";
import { subscribeModeDialog, type ModeDialogKind } from "@/lib/appMode/modeDialogRequests";
import { requestDiagnosticsOpen } from "@/lib/diagnostics/diagnosticsOverlay";
import { addErrorLog } from "@/lib/logging";

const report = (operation: string, error: unknown) =>
  addErrorLog(`Mode switch failed: ${operation}`, {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });

/**
 * The three dialogs of the mode switch — enter, leave and the badge's mode sheet — behind one
 * request bus, so the Settings section, the Quick menu, the badge, Home and Diagnostics all open
 * the same words.
 */
export function ModeDialogs() {
  const [open, setOpen] = useState<ModeDialogKind | null>(null);
  const navigate = useNavigate();
  const { profile } = useDisplayProfile();
  const compact = profile === "compact";

  useEffect(() => subscribeModeDialog(setOpen), []);

  const [entering, setEntering] = useState(false);

  const close = () => setOpen(null);
  const run = (operation: string, action: () => Promise<void>, after?: () => void) => {
    close();
    action().then(
      () => after?.(),
      (error: unknown) => report(operation, error),
    );
  };
  // The dialog stays up while the machine is let go of, so the wait has a face and a second press has no button.
  const enter = () => {
    if (entering) return;
    setEntering(true);
    enterSidPlayer()
      .then(
        () => navigate("/play", { replace: true }),
        (error: unknown) => report("enter", error),
      )
      .finally(() => {
        setEntering(false);
        close();
      });
  };

  return (
    <>
      <Dialog open={open === "enter"} onOpenChange={(next) => !next && !entering && close()}>
        <DialogContent data-testid="mode-dialog-enter">
          <DialogHeader>
            <DialogTitle>{MODE_COPY.enter.title}</DialogTitle>
            <DialogDescription className="not-sr-only" data-testid="mode-dialog-enter-body">
              {compact ? MODE_COPY.enter.compactBody : MODE_COPY.enter.body}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <div className="flex w-full flex-col gap-2 sm:flex-row-reverse sm:justify-start">
              <Button data-testid="mode-dialog-enter-confirm" className="min-h-11" disabled={entering} onClick={enter}>
                {entering ? MODE_COPY.enter.switching : MODE_COPY.enter.confirm}
              </Button>
              <Button
                variant="outline"
                className="min-h-11"
                data-testid="mode-dialog-cancel"
                disabled={entering}
                onClick={close}
              >
                {MODE_COPY.enter.cancel}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open === "leave"} onOpenChange={(next) => !next && close()}>
        <DialogContent data-testid="mode-dialog-leave">
          <DialogHeader>
            <DialogTitle>{MODE_COPY.leave.title}</DialogTitle>
            <DialogDescription className="not-sr-only" data-testid="mode-dialog-leave-body">
              {compact ? MODE_COPY.leave.compactBody : MODE_COPY.leave.body}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <div className="flex w-full flex-col gap-2 sm:flex-row-reverse sm:justify-start">
              <Button
                data-testid="mode-dialog-leave-full-app"
                className="min-h-11"
                onClick={() => run("full-app", switchToFullApp)}
              >
                {MODE_COPY.leave.confirmFullApp}
              </Button>
              <Button
                variant="secondary"
                data-testid="mode-dialog-leave-demo-mode"
                className="min-h-11"
                onClick={() => run("demo-mode", switchToDemoMode)}
              >
                {MODE_COPY.leave.confirmDemoMode}
              </Button>
              <Button variant="outline" className="min-h-11" data-testid="mode-dialog-cancel" onClick={close}>
                {MODE_COPY.leave.cancel}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open === "sheet"} onOpenChange={(next) => !next && close()}>
        <DialogContent data-testid="mode-sheet">
          <DialogHeader>
            <DialogTitle>{MODE_COPY.sheet.title}</DialogTitle>
            <DialogDescription>{MODE_COPY.sheet.body}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-4 sm:px-6">
            <p className="text-sm text-muted-foreground">{MODE_COPY.sheet.body}</p>
            <DeviceLessChoices onChosen={close} />
            <Button
              variant="outline"
              className="min-h-11 w-full justify-start"
              data-testid="mode-sheet-diagnostics"
              onClick={() => {
                close();
                requestDiagnosticsOpen("header");
              }}
            >
              Diagnostics
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
