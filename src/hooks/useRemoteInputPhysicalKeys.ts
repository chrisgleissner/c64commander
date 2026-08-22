/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";

import type { JoystickInputName } from "@/lib/c64api";
import { resolveInputProfile } from "@/lib/input/profiles";
import { resolveSemanticAction } from "@/lib/input/keyEvent";
import { setInputModality } from "@/lib/input/inputModality";
import type { SemanticAction } from "@/lib/input";
import {
  resolveJoystickInputs,
  type DeviceRotation,
  type JoystickKeyBinding,
} from "@/lib/remoteInput/joystickKeyBindings";
import type { RemoteInputOutputMode } from "@/hooks/useRemoteInputSession";
import type { AvMirrorImmersiveHandle } from "@/components/streams/AvMirrorImmersive";

// Matches the profile the app applies globally (App.tsx's FocusNavigationProvider
// profileId) so physical-key resolution is consistent with the rest of the UI.
const PHYSICAL_INPUT_KEYMAP = resolveInputProfile("keypad");

export interface RemoteInputPhysicalKeysOptions {
  outputMode: RemoteInputOutputMode;
  heldJoystickInputs: ReadonlySet<JoystickInputName>;
  setHeldJoystickInputs: (next: ReadonlySet<JoystickInputName>) => void;
  releaseAllEpoch: number;
  mirrorRef: RefObject<AvMirrorImmersiveHandle | null>;
  binding: JoystickKeyBinding;
  rotation: DeviceRotation;
  /** Called when `#` is pressed, where that key has a role — Game Mode's overlay row. */
  onHashKey?: () => void;
  /**
   * Called when a physical key is relayed to the C64 as a joystick input.
   *
   * Narrower than "a key was pressed" on purpose: this is the signal Game Mode's
   * `auto` joystick setting acts on, and only a key that actually steered the game is
   * evidence that the player has put the touchscreen down. Adjusting the mirror
   * view, opening the quick keys, or pressing a key with no binding are all things
   * a player does WITH the phone in hand, and none of them reaches this.
   */
  onJoystickKeyRelayed?: () => void;
}

export interface RemoteInputPhysicalKeys {
  handleKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  handleKeyUp: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  /** Forget every tracked key and what it last contributed. */
  clearHeldKeys: () => void;
}

/**
 * Physical T9 / D-pad capture for the Remote Input sheet.
 *
 * While focus is inside the sheet (`[role=dialog]`) the app's global keypad
 * handler bows out entirely (`isWithinOpenOverlay` in `useFocusNavigation`), so
 * these keys are free to be reinterpreted as joystick input with no conflict
 * against the focus ring.
 */
export const useRemoteInputPhysicalKeys = ({
  outputMode,
  heldJoystickInputs,
  setHeldJoystickInputs,
  releaseAllEpoch,
  mirrorRef,
  binding,
  rotation,
  onHashKey,
  onJoystickKeyRelayed,
}: RemoteInputPhysicalKeysOptions): RemoteInputPhysicalKeys => {
  const heldPhysicalKeysRef = useRef<Set<SemanticAction>>(new Set());
  const previousPhysicalInputsRef = useRef<Set<JoystickInputName>>(new Set());

  const clearHeldKeys = useCallback(() => {
    heldPhysicalKeysRef.current.clear();
    previousPhysicalInputsRef.current.clear();
  }, []);

  // Merge with the session's current held set instead of replacing it wholesale: a
  // device with both physical keys and touch (e.g. a fire button held via touch)
  // must not have the touch-held inputs clobbered by a physical key press or
  // release. Only inputs this function itself contributed last time are eligible
  // for removal; anything the rest of the sheet is holding survives untouched.
  const recomputePhysicalHeldSet = useCallback(() => {
    const currentPhysicalInputs = new Set<JoystickInputName>();
    heldPhysicalKeysRef.current.forEach((action) => {
      resolveJoystickInputs(action, binding, rotation).forEach((input) => currentPhysicalInputs.add(input));
    });
    const next = new Set(heldJoystickInputs);
    previousPhysicalInputsRef.current.forEach((input) => {
      if (!currentPhysicalInputs.has(input)) next.delete(input);
    });
    currentPhysicalInputs.forEach((input) => next.add(input));
    previousPhysicalInputsRef.current = currentPhysicalInputs;
    setHeldJoystickInputs(next);
  }, [heldJoystickInputs, setHeldJoystickInputs, binding, rotation]);

  const recomputeRef = useRef(recomputePhysicalHeldSet);
  recomputeRef.current = recomputePhysicalHeldSet;

  // A rotation change does not change which keys are down, but it does change what
  // they mean. Without re-deriving here, a player holding the left key who turns
  // the handset keeps `left` asserted forever while the new direction is added on
  // top — the machine sees a diagonal nobody pressed, and `left` never releases
  // because the key-up now maps somewhere else.
  useEffect(() => {
    if (heldPhysicalKeysRef.current.size === 0) return;
    recomputeRef.current();
  }, [rotation]);

  const handleMirrorKey = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>, action: SemanticAction | null): boolean => {
      const mirrorHandle = mirrorRef.current;
      if (!mirrorHandle || !action) return false;
      // A/V mirror view-lock (06-av-mirror-ux §7.1): the `*`/menu key ALWAYS flips
      // between driving the C64 and adjusting the view (never ambiguous); while adjusting,
      // physical keys pan/zoom the mirror instead of relaying to the C64.
      if (action === "star" || action === "openMenu") {
        event.preventDefault();
        mirrorHandle.toggleMode();
        return true;
      }
      if (mirrorHandle.getMode() !== "adjust") return false;
      let handled = true;
      switch (action) {
        case "dpadUp":
        case "digit2":
          mirrorHandle.panStep(0, -1);
          break;
        case "dpadDown":
        case "digit8":
          mirrorHandle.panStep(0, 1);
          break;
        case "dpadLeft":
        case "digit4":
          mirrorHandle.panStep(-1, 0);
          break;
        case "dpadRight":
        case "digit6":
          mirrorHandle.panStep(1, 0);
          break;
        case "digit3":
        case "digit9":
          mirrorHandle.zoomIn();
          break;
        case "digit1":
        case "digit7":
          mirrorHandle.zoomOut();
          break;
        case "digit0":
        case "digit5":
          mirrorHandle.reset();
          break;
        // OK confirms what is under the crosshair, and lets it go again. A handset with no
        // touchscreen has no long press to make, so this is the whole of follow-focus there —
        // and it is why `0`/`5` keep Fit rather than sharing the key.
        case "center":
        case "enter":
          mirrorHandle.toggleLock();
          break;
        default:
          handled = false;
      }
      if (handled) event.preventDefault();
      return handled;
    },
    [mirrorRef],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const action = resolveSemanticAction(PHYSICAL_INPUT_KEYMAP, event);
      if (handleMirrorKey(event, action)) return;
      if (action === "hash" && onHashKey) {
        event.preventDefault();
        onHashKey();
        return;
      }

      if (outputMode !== "joystick" || !action) return;
      const inputs = resolveJoystickInputs(action, binding, rotation);
      if (!inputs.length) return;
      event.preventDefault();
      // The sheet intercepts these keys before the global handler sees them, so the
      // app-wide modality would otherwise still read "pointer" after a whole game
      // played on the keypad — and the focus ring the next screen draws depends on
      // it. Whether Game Mode keeps the on-screen joystick does NOT read this; it
      // reads the callback below, which is scoped to keys that steered the game.
      setInputModality("key-navigation");
      onJoystickKeyRelayed?.();
      if (heldPhysicalKeysRef.current.has(action)) return;
      heldPhysicalKeysRef.current.add(action);
      recomputePhysicalHeldSet();
    },
    [outputMode, binding, rotation, recomputePhysicalHeldSet, handleMirrorKey, onHashKey, onJoystickKeyRelayed],
  );

  const handleKeyUp = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const action = resolveSemanticAction(PHYSICAL_INPUT_KEYMAP, event);
      if (!action || !heldPhysicalKeysRef.current.has(action)) return;
      heldPhysicalKeysRef.current.delete(action);
      recomputePhysicalHeldSet();
    },
    [recomputePhysicalHeldSet],
  );

  // Clear tracked physical keys (and what they last contributed) on every
  // output-mode change. Without this, a direction held while switching to Type
  // mode (no keyup, e.g. the user's thumb never lifts) stays recorded, and
  // switching back to Joystick mode later resurrects it as phantom-held alongside
  // whatever is pressed next — or wrongly strips a same-named input that a NEW
  // touch hold contributed in the meantime, since the merge above only knows to
  // remove what it itself added.
  useEffect(() => {
    clearHeldKeys();
  }, [outputMode, clearHeldKeys]);

  // `releaseAll` (panic button, backgrounding) clears the session's shared held set
  // while this component stays mounted, and had no channel into these refs. Reset
  // on the EXPLICIT epoch signal — NOT on an empty shared set: a physical and a
  // touch source can hold the same direction, so releasing one can momentarily
  // empty the set while a physical key is still down.
  useEffect(() => {
    clearHeldKeys();
  }, [releaseAllEpoch, clearHeldKeys]);

  return { handleKeyDown, handleKeyUp, clearHeldKeys };
};
