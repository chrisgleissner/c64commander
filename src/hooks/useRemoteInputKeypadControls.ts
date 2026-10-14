/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { resolveSemanticAction } from "@/lib/input/keyEvent";
import { resolveInputProfile } from "@/lib/input/profiles";
import { SKIP_ATTR } from "@/lib/input/discovery";
import { SOFT_KEY_MENU_ATTR } from "@/lib/input/guidance";
import { stepFocusWithinOverlay } from "@/lib/input/ringDom";
import type { RemoteInputOutputMode } from "@/hooks/useRemoteInputSession";
import type { RemoteInputControlsMenuItem } from "@/components/remoteInput/RemoteInputControlsMenu";

export const REMOTE_INPUT_SHEET_SELECTOR = '[data-testid="remote-input-sheet"]';
const OPTIONS_TOGGLE_SELECTOR = '[data-testid="remote-input-joystick-options"]';
const CLOSE_SELECTOR = '[data-testid="remote-input-close"]';

type FocusAfterMenu = "sheet" | "first-control" | "options";

export interface RemoteInputKeypadControlsOptions {
  open: boolean;
  outputMode: RemoteInputOutputMode;
  /** False where the keypad's keys have nothing to do on the C64, as in Keys mode without T9. */
  keypadDrivesTheC64: boolean;
  joystickAvailable: boolean;
  gameModeAvailable: boolean;
  immersive: boolean;
  /** Whether the sheet folds its joystick options behind an Options button. */
  optionsFolded: boolean;
  onOutputModeChange: (mode: RemoteInputOutputMode) => void;
  onOpenOptions: () => void;
  onEnterGameMode: () => void;
  onExitGameMode: () => void;
  onReleaseAll: () => void;
  onClose: () => void;
}

/**
 * Who the keypad talks to while the Remote Input sheet is open.
 *
 * Driving (the default): every key goes to the C64, and the sheet tells the app-wide navigation
 * to leave its keys alone, so Up or Down can never park focus on a control that the next OK would
 * press instead of firing. The right soft key opens a menu of the sheet's controls.
 *
 * Operating the sheet ("Other controls", or "Options"): nothing goes to the C64; the ordinary
 * overlay navigation walks the sheet's controls and OK presses them. Back returns to driving.
 */
export const useRemoteInputKeypadControls = (options: RemoteInputKeypadControlsOptions) => {
  const { open, outputMode, keypadDrivesTheC64, joystickAvailable, gameModeAvailable, immersive, optionsFolded } =
    options;
  const [driving, setDriving] = useState(true);
  const keysGoToTheC64 = driving && keypadDrivesTheC64;
  const inGameMode = gameModeAvailable && immersive;
  const [menuOpen, setMenuOpen] = useState(false);
  const focusAfterMenuRef = useRef<FocusAfterMenu>("sheet");

  useEffect(() => {
    if (open) return;
    setDriving(true);
    setMenuOpen(false);
  }, [open]);

  const focusSheet = () => document.querySelector<HTMLElement>(REMOTE_INPUT_SHEET_SELECTOR)?.focus();

  const onMenuClosed = useCallback(() => {
    const sheet = document.querySelector<HTMLElement>(REMOTE_INPUT_SHEET_SELECTOR);
    if (!sheet) return;
    const target = focusAfterMenuRef.current;
    focusAfterMenuRef.current = "sheet";
    if (target === "options") sheet.querySelector<HTMLElement>(OPTIONS_TOGGLE_SELECTOR)?.focus();
    else if (target === "first-control")
      stepFocusWithinOverlay(sheet, sheet.querySelector(CLOSE_SELECTOR) ?? sheet, true);
    else sheet.focus();
  }, []);

  const operateTheSheet = (focus: FocusAfterMenu) => {
    focusAfterMenuRef.current = focus;
    setDriving(false);
  };

  const items: RemoteInputControlsMenuItem[] = [];
  if (!driving) {
    items.push({ id: "drive", label: "Back to the C64", onSelect: () => setDriving(true) });
  }
  if (joystickAvailable && outputMode !== "joystick" && !inGameMode) {
    items.push({ id: "joystick", label: "Joystick", onSelect: () => options.onOutputModeChange("joystick") });
  }
  if (outputMode !== "type" && !inGameMode) {
    items.push({ id: "keys", label: "Keys", onSelect: () => options.onOutputModeChange("type") });
  }
  if (outputMode === "joystick" && optionsFolded) {
    items.push({
      id: "options",
      label: "Options",
      onSelect: () => {
        options.onOpenOptions();
        operateTheSheet("options");
      },
    });
  }
  if (gameModeAvailable) {
    items.push(
      inGameMode
        ? { id: "game", label: "Exit Game Mode", onSelect: options.onExitGameMode }
        : { id: "game", label: "Game Mode", onSelect: options.onEnterGameMode },
    );
  }
  items.push(
    { id: "controls", label: "Other controls", onSelect: () => operateTheSheet("first-control") },
    { id: "release-all", label: "Release all", onSelect: options.onReleaseAll },
    { id: "close", label: "Close Remote Input", onSelect: options.onClose },
  );

  /** True when the key is the sheet's to handle here and must not reach the C64. */
  const interceptKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>): boolean => {
      if (resolveSemanticAction(resolveInputProfile("keypad"), event) === "softRight") {
        event.preventDefault();
        setMenuOpen((wasOpen) => !wasOpen);
        return true;
      }
      // The menu is portalled, but React still bubbles its keys through the sheet.
      if (menuOpen) return true;
      return !driving;
    },
    [menuOpen, driving],
  );

  const onEscapeKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (driving) return;
      event.preventDefault();
      setDriving(true);
      focusSheet();
    },
    [driving],
  );

  const sheetProps = {
    ...(keysGoToTheC64 ? { [SKIP_ATTR]: "" } : {}),
    [SOFT_KEY_MENU_ATTR]: "",
    onEscapeKeyDown,
  };

  return {
    interceptKeyDown,
    sheetProps,
    menu: { open: menuOpen, onOpenChange: setMenuOpen, items, onClosed: onMenuClosed },
  };
};
