/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { JoystickInputName, KeyboardInputName, MachineInputEvent } from "@/lib/c64api/machineInputTypes";
import type { HeldJoystickInputs } from "@/lib/remoteInput/joystickHeldSet";
import type { HeldKeyboardInputs } from "@/lib/remoteInput/keyboardHeldSet";

export type OwnHeldInputs = {
  joystick: HeldJoystickInputs;
  port: 1 | 2;
  keyboard: HeldKeyboardInputs;
};

/** Whether delivering this event can leave an input held on the C64. A keyboard tap cannot: the firmware releases it. */
export const holdsInput = (event: MachineInputEvent) =>
  event.kind === "joystick" || (event.kind === "keyboard" && event.transition !== "tap");

/**
 * Releases exactly what this phone may be holding on the C64: its last-sent held inputs, plus every
 * input a batch whose outcome is unknown may have pressed.
 *
 * The Ultimate keeps one input state for all of its clients, so `release_all` also lets go of what
 * another phone is holding. That is right for the user's own Release all control and wrong for
 * this phone closing its sheet, switching mode or losing focus.
 */
export const buildOwnReleaseEvents = (
  held: OwnHeldInputs,
  unconfirmed: readonly MachineInputEvent[] = [],
): MachineInputEvent[] => {
  const joystick = new Map<1 | 2, Set<JoystickInputName>>();
  const holdOnPort = (port: 1 | 2, inputs: Iterable<JoystickInputName>) => {
    const set = joystick.get(port) ?? new Set<JoystickInputName>();
    for (const input of inputs) set.add(input);
    joystick.set(port, set);
  };
  holdOnPort(held.port, held.joystick);
  const keyboard = new Set<KeyboardInputName>(held.keyboard);
  for (const event of unconfirmed.filter(holdsInput)) {
    if (event.kind === "joystick") holdOnPort(event.port, event.inputs);
    else if (event.kind === "keyboard") event.inputs.forEach((input) => keyboard.add(input));
  }
  const events: MachineInputEvent[] = [];
  for (const [port, inputs] of joystick) {
    if (inputs.size) events.push({ kind: "joystick", port, inputs: [...inputs], transition: "release" });
  }
  if (keyboard.size) events.push({ kind: "keyboard", inputs: [...keyboard], transition: "release" });
  return events;
};

/** Press events for inputs this phone sent, or queued to send, that no confirmed release has covered yet. */
export type UnreleasedInputs = readonly MachineInputEvent[];

export const NO_UNRELEASED_INPUTS: UnreleasedInputs = [];

type TransitionEvent = Exclude<MachineInputEvent, { kind: "release_all" }>;

const isPress = (event: MachineInputEvent): event is TransitionEvent =>
  event.kind !== "release_all" && holdsInput(event) && event.transition !== "release";

const isRelease = (event: MachineInputEvent): event is TransitionEvent =>
  event.kind !== "release_all" && event.transition === "release";

const sameInputGroup = (a: TransitionEvent, b: TransitionEvent) =>
  a.kind === b.kind && (a.kind !== "joystick" || a.port === (b as typeof a).port);

export const withPressedInputs = (
  unreleased: UnreleasedInputs,
  batch: readonly MachineInputEvent[],
): UnreleasedInputs => {
  const presses = batch.filter(isPress);
  return presses.length ? [...unreleased, ...presses] : unreleased;
};

/** Forgets the inputs that a batch about to be sent to the device releases. */
export const withoutReleasedInputs = (
  unreleased: UnreleasedInputs,
  confirmedBatch: readonly MachineInputEvent[],
): UnreleasedInputs => {
  if (confirmedBatch.some((event) => event.kind === "release_all")) return NO_UNRELEASED_INPUTS;
  let remaining = unreleased;
  for (const release of confirmedBatch.filter(isRelease)) {
    const released = new Set<string>(release.inputs);
    remaining = remaining.flatMap((press) => {
      if (!isPress(press) || !sameInputGroup(press, release)) return [press];
      const inputs = press.inputs.filter((input) => !released.has(input));
      return inputs.length ? [{ ...press, inputs } as TransitionEvent] : [];
    });
  }
  return remaining;
};
