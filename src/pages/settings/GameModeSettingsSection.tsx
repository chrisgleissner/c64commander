/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { resolveInputProfile } from "@/lib/input/profiles";
import { resolveSemanticAction } from "@/lib/input/keyEvent";
import type { SemanticAction } from "@/lib/input";
import {
  bindSlot,
  clearSlot,
  isReservedJoystickAction,
  JOYSTICK_LAYOUT_LABEL,
  JOYSTICK_SLOT_LABEL,
  JOYSTICK_SLOTS,
  loadCustomBinding,
  loadJoystickLayout,
  RESERVED_ACTION_ROLE,
  saveCustomBinding,
  saveJoystickLayout,
  type JoystickKeyBinding,
  type JoystickLayoutId,
  type JoystickSlot,
} from "@/lib/remoteInput/joystickKeyBindings";
import {
  GAME_MODE_JOYSTICK_LABEL,
  GAME_MODE_JOYSTICK_SETTINGS,
  loadGameModeJoystick,
  saveGameModeJoystick,
  type GameModeJoystickSetting,
} from "@/lib/remoteInput/gameModeJoystick";
import { loadGameModeOnLaunch, saveGameModeOnLaunch } from "@/lib/remoteInput/gameModeLaunch";

const KEYPAD_KEYMAP = resolveInputProfile("keypad");

const LAYOUT_ORDER: readonly JoystickLayoutId[] = ["diamond8", "classicT9", "custom"];

/** How a captured action reads back to the user, without exposing the internal name. */
const ACTION_LABEL: Partial<Record<SemanticAction, string>> = {
  digit0: "0",
  digit1: "1",
  digit2: "2",
  digit3: "3",
  digit4: "4",
  digit5: "5",
  digit6: "6",
  digit7: "7",
  digit8: "8",
  digit9: "9",
  dpadUp: "D-pad up",
  dpadDown: "D-pad down",
  dpadLeft: "D-pad left",
  dpadRight: "D-pad right",
  center: "D-pad centre",
  enter: "OK",
};

const describeAction = (action: SemanticAction | undefined): string =>
  action === undefined ? "Not set" : (ACTION_LABEL[action] ?? action);

/**
 * Settings → Remote Input's Game Mode block: which physical keys steer, whether the
 * on-screen controls are drawn, and whether launching a game enters Game Mode.
 *
 * Bindings are assigned by PRESSING the key rather than picked from a list. It is
 * the only route that works on a handset with no touchscreen, and the only one that
 * is correct when the app cannot predict what a key reports.
 */
export const GameModeSettingsSection = () => {
  const [layout, setLayout] = useState<JoystickLayoutId>(loadJoystickLayout);
  const [customBinding, setCustomBinding] = useState<JoystickKeyBinding>(loadCustomBinding);
  const [joystick, setJoystick] = useState<GameModeJoystickSetting>(loadGameModeJoystick);
  const [onLaunch, setOnLaunch] = useState<boolean>(loadGameModeOnLaunch);
  const [capturingSlot, setCapturingSlot] = useState<JoystickSlot | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const capturingSlotRef = useRef<JoystickSlot | null>(null);
  capturingSlotRef.current = capturingSlot;

  const applyCustomBinding = useCallback((next: JoystickKeyBinding) => {
    setCustomBinding(next);
    saveCustomBinding(next);
  }, []);

  useEffect(() => {
    if (capturingSlot === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const slot = capturingSlotRef.current;
      if (slot === null) return;
      const action = resolveSemanticAction(KEYPAD_KEYMAP, event);
      if (!action) return;
      event.preventDefault();
      if (action === "back" || action === "escape") {
        setCapturingSlot(null);
        return;
      }
      if (isReservedJoystickAction(action)) {
        setRejection(
          `That key already ${RESERVED_ACTION_ROLE[action] ?? "has a role in Game Mode"}, so it cannot steer.`,
        );
        return;
      }
      setRejection(null);
      setCapturingSlot(null);
      setCustomBinding((current) => {
        const next = bindSlot(current, slot, action);
        saveCustomBinding(next);
        return next;
      });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [capturingSlot]);

  return (
    <div className="space-y-4" data-testid="settings-game-mode-section">
      <div className="space-y-2">
        <Label htmlFor="settings-joystick-key-layout" className="text-sm">
          Joystick keys
        </Label>
        <Select
          value={layout}
          onValueChange={(value) => {
            const next = value as JoystickLayoutId;
            setLayout(next);
            saveJoystickLayout(next);
          }}
        >
          <SelectTrigger id="settings-joystick-key-layout" data-testid="settings-joystick-key-layout">
            <SelectValue placeholder="Select a layout" />
          </SelectTrigger>
          <SelectContent>
            {LAYOUT_ORDER.map((id) => (
              <SelectItem key={id} value={id}>
                {JOYSTICK_LAYOUT_LABEL[id]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Which physical keys steer the joystick. <strong>Diamond</strong> uses the four keys around 8, with 8 as fire;{" "}
          <strong>Classic T9</strong> uses 2, 4, 6 and 8, with 5 as fire; <strong>Custom</strong> lets you press your
          own key per direction. The mapping turns with your device, so you set it up once, in portrait.
        </p>
      </div>

      {layout === "custom" ? (
        <div className="space-y-2" data-testid="settings-joystick-bindings">
          {JOYSTICK_SLOTS.map((slot) => (
            <div key={slot} className="flex items-center justify-between gap-3">
              <span className="text-sm">{JOYSTICK_SLOT_LABEL[slot]}</span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={capturingSlot === slot ? "default" : "secondary"}
                  data-testid={`settings-joystick-bind-${slot}`}
                  aria-pressed={capturingSlot === slot}
                  onClick={() => {
                    setRejection(null);
                    setCapturingSlot((current) => (current === slot ? null : slot));
                  }}
                >
                  {capturingSlot === slot ? "Press a key…" : describeAction(customBinding[slot])}
                </Button>
                {customBinding[slot] ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    data-testid={`settings-joystick-clear-${slot}`}
                    onClick={() => applyCustomBinding(clearSlot(customBinding, slot))}
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
          {rejection ? (
            <p className="text-xs text-destructive" role="alert" data-testid="settings-joystick-bind-rejection">
              {rejection}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="settings-game-mode-joystick" className="text-sm">
          On-screen joystick in Game mode
        </Label>
        <Select
          value={joystick}
          onValueChange={(value) => {
            const next = value as GameModeJoystickSetting;
            setJoystick(next);
            saveGameModeJoystick(next);
          }}
        >
          <SelectTrigger id="settings-game-mode-joystick" data-testid="settings-game-mode-joystick">
            <SelectValue placeholder="Select whether it is drawn" />
          </SelectTrigger>
          <SelectContent>
            {GAME_MODE_JOYSTICK_SETTINGS.map((setting) => (
              <SelectItem key={setting} value={setting}>
                {GAME_MODE_JOYSTICK_LABEL[setting]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Hiding the joystick gives the live picture the whole screen. <strong>Auto</strong> shows it until you steer
          with a physical key, then hides it until you touch it again. <strong>Visible</strong> always shows it;{" "}
          <strong>Hidden</strong> hides it as soon as the picture is on. Either way, the toolbar&apos;s{" "}
          <strong>Hide joystick</strong> / <strong>Show joystick</strong> buttons override this for the game you&apos;re
          playing. Press <kbd>#</kbd> for RETURN, SPACE, the other quick keys and the Live View switches, <kbd>*</kbd>{" "}
          to adjust the view, and Back to leave. With the picture off, the joystick stays on screen, so Game mode is
          never blank.
        </p>
      </div>

      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="min-w-0">
          <Label htmlFor="settings-game-mode-on-launch" className="font-medium">
            Enter Game Mode when a game starts
          </Label>
          <p className="text-xs text-muted-foreground">
            Launching a program, cartridge or disk image goes straight into Game Mode. Tunes are unaffected, and so is a
            playlist moving on by itself — only a game you started.
          </p>
        </div>
        <Checkbox
          id="settings-game-mode-on-launch"
          data-testid="settings-game-mode-on-launch"
          checked={onLaunch}
          onCheckedChange={(checked) => {
            const next = checked === true;
            setOnLaunch(next);
            saveGameModeOnLaunch(next);
          }}
        />
      </div>
    </div>
  );
};
