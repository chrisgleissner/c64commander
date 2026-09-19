/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";

import { MachineActionConfirmationDialog } from "@/pages/home/dialogs/MachineActionConfirmationDialog";
import { getC64API } from "@/lib/c64api";
import { useC64Connection, useC64MachineControl } from "@/hooks/useC64Connection";
import { publishMachineInterrupt } from "@/lib/deviceInteraction/machineInterrupt";
import { subscribeMachineCommand } from "@/lib/input/keypadCommands";
import { pauseResumeMachine } from "@/lib/machine/pauseResumeMachine";
import { getSelectedSavedDevice } from "@/lib/savedDevices/store";
import { addErrorLog } from "@/lib/logging";
import { reportUserError } from "@/lib/uiErrors";
import { toast } from "@/hooks/use-toast";

/**
 * The machine controls the keypad's `8` and `9` keys reach, from whatever page is open.
 *
 * Home's Quick Actions grid is where these live on screen and it is not moving: it reads well and
 * a pointer user finds them there. What it is not is close, for someone holding a keypad — Pause
 * was ten presses away and Reset eight, and both are among the things this user opens the app to
 * do. This answers the same two actions on their own keys, through the same implementations the
 * tiles use, so there is one set of rules about the SID mixer and one confirmation before a reset.
 */
export function KeypadMachineShortcuts() {
  const { status } = useC64Connection();
  const controls = useC64MachineControl();
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(
    () =>
      subscribeMachineCommand((command) => {
        if (!status.isConnected || busy) return;
        if (command === "reset") {
          setConfirmingReset(true);
          return;
        }
        setBusy(true);
        void (async () => {
          try {
            const moved = await pauseResumeMachine({
              api: getC64API(),
              deviceId: getSelectedSavedDevice()?.id ?? null,
              pause: () => controls.pause.mutateAsync(),
              resume: () => controls.resume.mutateAsync(),
            });
            toast({ title: moved === "paused" ? "Machine paused" : "Machine resumed" });
          } catch (error) {
            addErrorLog("Machine pause/resume failed", { error: (error as Error).message });
            reportUserError({
              operation: "KEYPAD_MACHINE_PAUSE_RESUME",
              title: "Machine action failed",
              description: (error as Error).message,
              error,
            });
          } finally {
            setBusy(false);
          }
        })();
      }),
    [busy, controls.pause, controls.resume, status.isConnected],
  );

  return (
    <MachineActionConfirmationDialog
      open={confirmingReset}
      action={{ actionName: "Reset", consequence: "This resets the running C64 session." }}
      onOpenChange={setConfirmingReset}
      onConfirm={() => {
        setConfirmingReset(false);
        void (async () => {
          try {
            await controls.reset.mutateAsync();
            // HARD19-031: publish the takeover so an armed playlist stops rather than auto-advancing
            // over the machine that was just reset.
            void publishMachineInterrupt({ reason: "home-reset", label: "Reset" });
            toast({ title: "Machine reset" });
          } catch (error) {
            reportUserError({
              operation: "KEYPAD_MACHINE_RESET",
              title: "Machine action failed",
              description: (error as Error).message,
              error,
            });
          }
        })();
      }}
    />
  );
}
