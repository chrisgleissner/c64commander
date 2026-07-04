/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Gamepad2,
  Keyboard as KeyboardIcon,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Wifi,
  WifiOff,
} from "lucide-react";
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
import {
  remoteInputSupportsJoystick,
  REMOTE_INPUT_AUTH_REQUIRED_HINT,
  REMOTE_INPUT_JOYSTICK_UNAVAILABLE_HINT,
} from "@/lib/remoteInput/capabilityTier";
import {
  DEFAULT_REMOTE_INPUT_CONTROL_SIZE,
  loadRemoteInputControlSize,
  remoteInputControlScale,
  REMOTE_INPUT_CONTROL_SIZE_LABEL,
  saveRemoteInputControlSize,
  stepRemoteInputControlSize,
  type RemoteInputControlSize,
} from "@/lib/remoteInput/remoteInputControlSettings";
import { VirtualJoystick } from "@/components/remoteInput/VirtualJoystick";
import { TypeKeyboard } from "@/components/remoteInput/TypeKeyboard";
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
 * HARD12-017 v1 / HARD13 ergonomics: the "Remote Input" sheet — a second-screen
 * joystick and keyboard for the C64.
 * Thin shell over the tested pure mappings (`@/lib/remoteInput/*`) and the
 * coalesced transport (`useRemoteInputSession`). Controls scale with a persisted
 * size preference and an immersive gaming mode strips everything but the
 * joystick action controls for no-look play — see docs/plans/hardening/13.
 */
export const RemoteInputSheet = ({ open, onOpenChange }: RemoteInputSheetProps) => {
  const { tier, loading: tierLoading, resolved } = useRemoteInputCapabilityTier(open);
  const session = useRemoteInputSession({ tier });
  const joystickAvailable = remoteInputSupportsJoystick(tier);
  // Lead F3: auth-required needs the same password Type mode's fallback
  // injection would also need, so the generic "Type mode still works" hint
  // is wrong on this tier specifically.
  const joystickUnavailableHint =
    tier === "auth-required" ? REMOTE_INPUT_AUTH_REQUIRED_HINT : REMOTE_INPUT_JOYSTICK_UNAVAILABLE_HINT;
  const heldPhysicalKeysRef = useRef<Set<string>>(new Set());
  const previousPhysicalInputsRef = useRef<Set<JoystickInputName>>(new Set());
  const [controlSize, setControlSize] = useState<RemoteInputControlSize>(DEFAULT_REMOTE_INPUT_CONTROL_SIZE);
  const [immersive, setImmersive] = useState(false);
  const scale = remoteInputControlScale(controlSize);

  // Rehydrate the persisted control-size preference when the sheet opens.
  useEffect(() => {
    if (open) setControlSize(loadRemoteInputControlSize());
  }, [open]);

  const changeSize = useCallback((direction: 1 | -1) => {
    setControlSize((current) => {
      const next = stepRemoteInputControlSize(current, direction);
      saveRemoteInputControlSize(next);
      return next;
    });
  }, []);

  // HARD13 residual (E2): merge with the session's current held set instead
  // of replacing it wholesale - a device with both physical keys and touch
  // (e.g. a fire button held via touch) must not have the touch-held inputs
  // clobbered by a physical key press/release. Only inputs this function
  // itself contributed last time are eligible for removal; anything the
  // rest of the sheet (touch) is holding survives untouched.
  const recomputePhysicalHeldSet = useCallback(() => {
    const currentPhysicalInputs = new Set<JoystickInputName>();
    heldPhysicalKeysRef.current.forEach((action) => {
      t9KeyToJoystickInputs(action as never).forEach((input) => currentPhysicalInputs.add(input));
      dpadActionToJoystickInputs(action as never).forEach((input) => currentPhysicalInputs.add(input));
    });
    const next = new Set(session.heldJoystickInputs);
    previousPhysicalInputsRef.current.forEach((input) => {
      if (!currentPhysicalInputs.has(input)) next.delete(input);
    });
    currentPhysicalInputs.forEach((input) => next.add(input));
    previousPhysicalInputsRef.current = currentPhysicalInputs;
    session.setHeldJoystickInputs(next);
  }, [session.heldJoystickInputs, session.setHeldJoystickInputs]);

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

  // Clear tracked physical keys (and what they last contributed) on every
  // output-mode change. Without this, a direction held while switching to
  // Type mode (no keyup, e.g. the user's thumb never lifts) stays recorded,
  // and switching back to Joystick mode later resurrects it as phantom-held
  // alongside whatever is pressed next - or, for `previousPhysicalInputsRef`,
  // wrongly strips a same-named input a NEW touch hold contributed in the
  // meantime (E2's merge logic only knows to remove what it itself added).
  useEffect(() => {
    heldPhysicalKeysRef.current.clear();
    previousPhysicalInputsRef.current.clear();
  }, [session.outputMode]);

  // Immersive mode is joystick-only; drop out of it if joystick relay becomes
  // unavailable (tier downgrade) so the user is never stranded in a stripped
  // layout that can't do anything.
  useEffect(() => {
    if (!joystickAvailable && immersive) setImmersive(false);
  }, [joystickAvailable, immersive]);

  // Smart default: when the connected device's REST API has no machine:input
  // support (keyboard-only), open straight into Type mode rather than a disabled
  // Joystick tab. Gated on `resolved` (HARD15-006), not merely `!tierLoading` -
  // the tier also reads as the default kernal-fallback value before any probe
  // has ever run AND during a transient connection blip mid-session (the tier
  // hook resets synchronously on disconnect). `resolved` distinguishes a
  // genuine probed answer from both of those, so a transient blip no longer
  // bounces the user out of Joystick mode - it only disables the tab (see the
  // hint below) until the tier resolves again.
  useEffect(() => {
    if (open && resolved && !tierLoading && !joystickAvailable && session.outputMode === "joystick") {
      session.setOutputMode("type");
    }
  }, [open, resolved, tierLoading, joystickAvailable, session.outputMode, session.setOutputMode]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        heldPhysicalKeysRef.current.clear();
        session.releaseAll();
        setImmersive(false);
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange, session.releaseAll],
  );

  const handleOutputModeChange = (mode: RemoteInputOutputMode) => {
    if (mode === "joystick" && !joystickAvailable) return;
    session.setOutputMode(mode);
  };

  // The size stepper scales the JOYSTICK action controls; the Type-tab keyboard
  // sizes itself from the measured available space instead, so this control is
  // joystick-only and hidden in Type mode (no compact vertical space spent on it).
  const sizeStepper = (
    <div className="flex items-center gap-1" data-testid="remote-input-size-stepper">
      <span className="mr-1 text-xs text-muted-foreground">Size</span>
      <Button
        size="icon"
        variant="secondary"
        className="h-8 w-8"
        aria-label="Smaller controls"
        data-testid="remote-input-size-decrease"
        disabled={controlSize === "M"}
        onClick={() => changeSize(-1)}
      >
        <Minus className="h-4 w-4" />
      </Button>
      <span className="w-8 text-center text-sm font-semibold" data-testid="remote-input-size-label">
        {REMOTE_INPUT_CONTROL_SIZE_LABEL[controlSize]}
      </span>
      <Button
        size="icon"
        variant="secondary"
        className="h-8 w-8"
        aria-label="Larger controls"
        data-testid="remote-input-size-increase"
        disabled={controlSize === "XXL"}
        onClick={() => changeSize(1)}
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );

  const immersiveToggle = joystickAvailable && session.outputMode === "joystick" && (
    <Button
      size="sm"
      variant={immersive ? "default" : "secondary"}
      data-testid="remote-input-immersive-toggle"
      aria-pressed={immersive}
      onClick={() => setImmersive((value) => !value)}
    >
      {immersive ? <Minimize2 className="mr-1.5 h-4 w-4" /> : <Maximize2 className="mr-1.5 h-4 w-4" />}
      {immersive ? "Exit game mode" : "Game mode"}
    </Button>
  );

  const showFooterActions = !(immersive && session.outputMode === "joystick");

  return (
    <AppSheet open={open} onOpenChange={handleOpenChange}>
      <AppSheetContent data-testid="remote-input-sheet" onKeyDown={handlePhysicalKeyDown} onKeyUp={handlePhysicalKeyUp}>
        <AppSheetHeader>
          <AppSheetTitle className="flex items-center gap-2">
            Remote Input
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
                <Wifi className="h-3.5 w-3.5" aria-label="Connected" />
              )}
            </span>
          </AppSheetTitle>
        </AppSheetHeader>
        <AppSheetBody className={cn("flex flex-col gap-4", (immersive || session.outputMode === "type") && "flex-1")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {immersive ? (
              <span className="text-sm font-semibold text-muted-foreground">Game mode</span>
            ) : (
              <div className="flex items-center gap-2" data-testid="remote-input-output-mode-toggle">
                <Button
                  size="sm"
                  variant={session.outputMode === "joystick" ? "default" : "secondary"}
                  data-testid="remote-input-mode-joystick"
                  disabled={!joystickAvailable}
                  title={!joystickAvailable ? joystickUnavailableHint : undefined}
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
                  <KeyboardIcon className="mr-1.5 h-4 w-4" /> Keys
                </Button>
              </div>
            )}
            <div className="flex items-center gap-2">
              {session.outputMode === "joystick" ? sizeStepper : null}
              {immersiveToggle}
            </div>
          </div>

          {!immersive && !joystickAvailable && session.outputMode === "joystick" ? (
            <p className="flex items-center justify-center gap-1.5 text-center text-sm text-muted-foreground">
              <AlertTriangle className="h-4 w-4" /> {joystickUnavailableHint}
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
              disabledHint={joystickUnavailableHint}
              scale={scale}
              immersive={immersive}
            />
          ) : (
            <TypeKeyboard
              className="min-h-0 flex-1"
              onChar={session.sendChar}
              onKey={session.sendKeyboardInputs}
              onCursor={session.sendCursor}
              onSpecialKey={session.sendSpecialKey}
              tier={tier}
            />
          )}

          {/* The quick-keys bar rides alongside the JOYSTICK for one-tap
              SPACE/RETURN/cursor without leaving game control; in Type mode the
              keyboard's own pinned deck already covers these, so it's omitted. */}
          {!immersive && session.outputMode === "joystick" ? (
            <QuickKeysBar
              onChar={session.sendChar}
              onCursor={session.sendCursor}
              onSpecialKey={session.sendSpecialKey}
              tier={tier}
              scale={scale}
              className="border-t border-border pt-3"
            />
          ) : null}
        </AppSheetBody>
        {showFooterActions ? (
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
              Close
            </Button>
          </AppSheetFooter>
        ) : null}
      </AppSheetContent>
    </AppSheet>
  );
};
