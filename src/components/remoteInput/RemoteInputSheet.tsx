/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef } from "react";
import { AlertTriangle, Gamepad2, Keyboard as KeyboardIcon, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AppSheet,
  AppSheetBody,
  AppSheetContent,
  AppSheetFooter,
  AppSheetHeader,
  AppSheetTitle,
} from "@/components/ui/app-surface";
import { cn } from "@/lib/utils";
import { useRemoteInputCapabilityTier } from "@/hooks/useRemoteInputCapabilityTier";
import { useRemoteInputSession, type RemoteInputOutputMode } from "@/hooks/useRemoteInputSession";
import { resolveInputProfile } from "@/lib/input/profiles";
import { resolveSemanticAction } from "@/lib/input/keyEvent";
import { dpadActionToJoystickInputs, t9KeyToJoystickInputs } from "@/lib/remoteInput/joystickDigitalMapping";
import { remoteInputSupportsJoystick, REMOTE_INPUT_JOYSTICK_UNAVAILABLE_HINT } from "@/lib/remoteInput/capabilityTier";
import { VirtualJoystick } from "@/components/remoteInput/VirtualJoystick";
import { OnScreenKeyboard } from "@/components/remoteInput/OnScreenKeyboard";
import { QuickKeysBar } from "@/components/remoteInput/QuickKeysBar";
import type { JoystickInputName } from "@/lib/c64api";

export type RemoteInputSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// Matches the profile the app applies globally (App.tsx's FocusNavigationProvider
// profileId) so physical-key resolution is consistent with the rest of the UI.
const PHYSICAL_INPUT_KEYMAP = resolveInputProfile("keypad");

/**
 * HARD12-017 v1: the "couch remote for your C64" sheet. Thin shell over the
 * tested pure mappings (`@/lib/remoteInput/*`) and the coalesced transport
 * (`useRemoteInputSession`) — see docs/plans/hardening/12-fable/plan.md.
 */
export const RemoteInputSheet = ({ open, onOpenChange }: RemoteInputSheetProps) => {
  const { tier } = useRemoteInputCapabilityTier(open);
  const session = useRemoteInputSession({ tier });
  const joystickAvailable = remoteInputSupportsJoystick(tier);
  const heldPhysicalKeysRef = useRef<Set<string>>(new Set());

  const recomputePhysicalHeldSet = useCallback(() => {
    const inputs = new Set<JoystickInputName>();
    heldPhysicalKeysRef.current.forEach((action) => {
      t9KeyToJoystickInputs(action as never).forEach((input) => inputs.add(input));
      dpadActionToJoystickInputs(action as never).forEach((input) => inputs.add(input));
    });
    session.setHeldJoystickInputs(inputs);
  }, [session]);

  // Physical T9/D-pad raw capture (Joystick mode only): while focus is inside
  // this sheet ([role=dialog]), the app's global keypad-navigation handler
  // already bows out entirely (see useFocusNavigation.tsx's
  // isWithinOpenOverlay guard), so these keys are free for us to reinterpret
  // as joystick input instead of focus movement — no conflict with the
  // existing focus-ring, and no changes needed to it.
  const handlePhysicalKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (session.outputMode !== "joystick") return;
      const action = resolveSemanticAction(PHYSICAL_INPUT_KEYMAP, event);
      if (!action) return;
      const inputs = [...t9KeyToJoystickInputs(action), ...dpadActionToJoystickInputs(action)];
      if (!inputs.length) return;
      event.preventDefault();
      if (heldPhysicalKeysRef.current.has(action)) return;
      heldPhysicalKeysRef.current.add(action);
      recomputePhysicalHeldSet();
    },
    [session.outputMode, recomputePhysicalHeldSet],
  );

  const handlePhysicalKeyUp = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const action = resolveSemanticAction(PHYSICAL_INPUT_KEYMAP, event);
      if (!action || !heldPhysicalKeysRef.current.has(action)) return;
      heldPhysicalKeysRef.current.delete(action);
      recomputePhysicalHeldSet();
    },
    [recomputePhysicalHeldSet],
  );

  // Clear tracked physical keys on every output-mode change. Without this, a
  // direction held while switching to Type mode (no keyup, e.g. the user's
  // thumb never lifts) stays recorded, and switching back to Joystick mode
  // later resurrects it as phantom-held alongside whatever is pressed next.
  useEffect(() => {
    heldPhysicalKeysRef.current.clear();
  }, [session.outputMode]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        heldPhysicalKeysRef.current.clear();
        session.releaseAll();
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange, session],
  );

  const handleOutputModeChange = (mode: RemoteInputOutputMode) => {
    if (mode === "joystick" && !joystickAvailable) return;
    session.setOutputMode(mode);
  };

  return (
    <AppSheet open={open} onOpenChange={handleOpenChange}>
      <AppSheetContent data-testid="remote-input-sheet" onKeyDown={handlePhysicalKeyDown} onKeyUp={handlePhysicalKeyUp}>
        <AppSheetHeader>
          <AppSheetTitle className="flex items-center gap-2">
            Remote Control
            <span
              className="flex items-center gap-1 text-xs font-normal text-muted-foreground"
              data-testid="remote-input-connection-indicator"
              data-status={session.connectionStatus}
            >
              {session.connectionStatus === "error" ? (
                <>
                  <WifiOff className="h-3.5 w-3.5" /> Reconnecting…
                </>
              ) : (
                <>
                  <Wifi className="h-3.5 w-3.5" /> Couch remote
                </>
              )}
            </span>
          </AppSheetTitle>
        </AppSheetHeader>
        <AppSheetBody className="flex flex-col gap-4">
          <div className="flex items-center justify-center gap-2" data-testid="remote-input-output-mode-toggle">
            <Button
              size="sm"
              variant={session.outputMode === "joystick" ? "default" : "secondary"}
              data-testid="remote-input-mode-joystick"
              disabled={!joystickAvailable}
              title={!joystickAvailable ? REMOTE_INPUT_JOYSTICK_UNAVAILABLE_HINT : undefined}
              onClick={() => handleOutputModeChange("joystick")}
            >
              <Gamepad2 className="mr-1.5 h-4 w-4" /> Joystick
            </Button>
            <Button
              size="sm"
              variant={session.outputMode === "type" ? "default" : "secondary"}
              data-testid="remote-input-mode-type"
              onClick={() => handleOutputModeChange("type")}
            >
              <KeyboardIcon className="mr-1.5 h-4 w-4" /> Type
            </Button>
          </div>

          {!joystickAvailable && session.outputMode === "joystick" ? (
            <p className="flex items-center justify-center gap-1.5 text-center text-sm text-muted-foreground">
              <AlertTriangle className="h-4 w-4" /> {REMOTE_INPUT_JOYSTICK_UNAVAILABLE_HINT}
            </p>
          ) : null}

          {session.outputMode === "joystick" ? (
            <VirtualJoystick
              port={session.port}
              onSetPort={session.setPort}
              heldInputs={session.heldJoystickInputs}
              onHeldInputsChange={session.setHeldJoystickInputs}
              autofireEnabled={session.autofireEnabled}
              onAutofireEnabledChange={session.setAutofireEnabled}
              disabled={!joystickAvailable}
              disabledHint={REMOTE_INPUT_JOYSTICK_UNAVAILABLE_HINT}
            />
          ) : (
            <OnScreenKeyboard onKey={session.sendKeyboardInputs} onSpecialKey={session.sendSpecialKey} tier={tier} />
          )}

          <QuickKeysBar
            onChar={session.sendChar}
            onCursor={session.sendCursor}
            onSpecialKey={session.sendSpecialKey}
            className={cn(session.outputMode === "joystick" && "border-t border-border pt-3")}
          />
        </AppSheetBody>
        <AppSheetFooter className="flex items-center justify-between">
          <Button
            size="sm"
            variant="destructive"
            data-testid="remote-input-panic-button"
            onClick={() => session.releaseAll()}
          >
            Release All
          </Button>
          <Button
            size="sm"
            variant="secondary"
            data-testid="remote-input-exit-button"
            onClick={() => handleOpenChange(false)}
          >
            Exit
          </Button>
        </AppSheetFooter>
      </AppSheetContent>
    </AppSheet>
  );
};
