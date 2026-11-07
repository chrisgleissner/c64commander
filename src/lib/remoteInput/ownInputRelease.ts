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

/**
 * A press sent or queued by this phone. `sequence` is taken when the batch is queued, so a release can tell the presses
 * queued before it (which it frees) from those queued after it (which it does not).
 */
export type SequencedPress = { sequence: number; press: MachineInputEvent };

/** Presses of inputs that no release dispatched after them has covered yet. */
export type UnreleasedInputs = readonly SequencedPress[];

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
  events: readonly MachineInputEvent[],
  sequence: number,
): UnreleasedInputs => {
  const presses = events.filter(isPress).map((press) => ({ sequence, press }));
  return presses.length ? [...unreleased, ...presses] : unreleased;
};

export const unreleasedPressEvents = (unreleased: UnreleasedInputs): MachineInputEvent[] =>
  unreleased.map(({ press }) => press);

/**
 * Forgets what a batch about to be dispatched releases, but only presses queued before it (a lower sequence). A press
 * queued after the release goes out after it and leaves its input held.
 */
export const withoutReleasedInputs = (
  unreleased: UnreleasedInputs,
  batch: readonly MachineInputEvent[],
  sequence: number,
): UnreleasedInputs => {
  const queuedAfter = ({ sequence: pressSequence }: SequencedPress) => pressSequence >= sequence;
  if (batch.some((event) => event.kind === "release_all")) return unreleased.filter(queuedAfter);
  let remaining = unreleased;
  for (const release of batch.filter(isRelease)) {
    const released = new Set<string>(release.inputs);
    remaining = remaining.flatMap((entry) => {
      const { press } = entry;
      if (queuedAfter(entry) || !isPress(press) || !sameInputGroup(press, release)) return [entry];
      const inputs = press.inputs.filter((input) => !released.has(input));
      return inputs.length ? [{ ...entry, press: { ...press, inputs } as TransitionEvent }] : [];
    });
  }
  return remaining;
};
