/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppMode } from "@/lib/appMode/appModeStore";
import { MODE_NAMES } from "@/lib/appMode/copy";
import { requestModeDialog } from "@/lib/appMode/modeDialogRequests";
import { switchToDemoMode, switchToFullApp } from "@/lib/appMode/appModeTransitions";
import { useConnectionState } from "@/hooks/useConnectionState";
import { addErrorLog } from "@/lib/logging";

type ChoiceId = "full-app" | "demo-mode" | "sid-player";

const reportSwitchFailure = (choice: ChoiceId, error: unknown) =>
  addErrorLog("Switching the app mode failed", {
    choice,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });

/**
 * The sibling choices of the app — Full App, Demo Mode, SID Player — with the current one marked.
 * Every place that lets a person change mode renders this one component, so the transitions and the
 * wording exist once.
 */
export function DeviceLessChoices({ onChosen, className }: { onChosen?: () => void; className?: string }) {
  const appMode = useAppMode();
  const { state } = useConnectionState();
  const current: ChoiceId =
    appMode === "sid-player" ? "sid-player" : state === "DEMO_ACTIVE" ? "demo-mode" : "full-app";

  const choose = (choice: ChoiceId) => {
    if (choice === current) return;
    onChosen?.();
    if (choice === "sid-player") {
      requestModeDialog("enter");
      return;
    }
    if (appMode === "sid-player") {
      requestModeDialog("leave");
      return;
    }
    const switching = choice === "full-app" ? switchToFullApp() : switchToDemoMode();
    switching.catch((error: unknown) => reportSwitchFailure(choice, error));
  };

  const choices: ReadonlyArray<{ id: ChoiceId; label: string }> = [
    { id: "full-app", label: MODE_NAMES.fullApp },
    { id: "demo-mode", label: MODE_NAMES.demoMode },
    { id: "sid-player", label: MODE_NAMES.sidPlayer },
  ];

  return (
    <div className={cn("grid gap-2", className)} role="group" aria-label="App mode" data-testid="device-less-choices">
      {choices.map(({ id, label }) => (
        <Button
          key={id}
          type="button"
          variant={id === current ? "default" : "outline"}
          className="min-h-11 w-full justify-start"
          aria-pressed={id === current}
          data-current={id === current ? "true" : "false"}
          data-testid={`device-less-choice-${id}`}
          onClick={() => choose(id)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
