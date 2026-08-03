/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { JoystickInputName } from "@/lib/c64api";
import { SEMANTIC_ACTIONS, type SemanticAction } from "@/lib/input";
import { variant } from "@/generated/variant";

/**
 * Which physical keys steer the joystick, and how that arrangement follows the
 * handset when it is turned.
 *
 * A binding maps a joystick SLOT to a {@link SemanticAction} — never to a raw key
 * code — so a handset that reports different codes is handled once, in the
 * `keypad` input profile. Only the portrait binding is ever stored: every other
 * orientation is the same binding under a rotation of the slot circle, so the
 * required per-orientation tables are a consequence of one rule rather than data
 * that has to be kept in step with it.
 */
export type JoystickSlot = "up" | "upRight" | "right" | "downRight" | "down" | "downLeft" | "left" | "upLeft" | "fire";

export type JoystickKeyBinding = Partial<Record<JoystickSlot, SemanticAction>>;

export type JoystickLayoutId = "diamond8" | "classicT9" | "custom";

export type DeviceRotation = 0 | 90 | 180 | 270;

export const DEVICE_ROTATIONS: readonly DeviceRotation[] = [0, 90, 180, 270];

/** The eight direction slots in clockwise order, starting at up. `fire` is not on the circle. */
const DIRECTION_SLOTS: readonly JoystickSlot[] = [
  "up",
  "upRight",
  "right",
  "downRight",
  "down",
  "downLeft",
  "left",
  "upLeft",
];

const SLOT_INPUTS: Record<JoystickSlot, readonly JoystickInputName[]> = {
  up: ["up"],
  upRight: ["up", "right"],
  right: ["right"],
  downRight: ["down", "right"],
  down: ["down"],
  downLeft: ["down", "left"],
  left: ["left"],
  upLeft: ["up", "left"],
  fire: ["fire"],
};

export const JOYSTICK_SLOTS: readonly JoystickSlot[] = [...DIRECTION_SLOTS, "fire"];

export const JOYSTICK_SLOT_LABEL: Record<JoystickSlot, string> = {
  up: "Up",
  upRight: "Up + right",
  right: "Right",
  downRight: "Down + right",
  down: "Down",
  downLeft: "Down + left",
  left: "Left",
  upLeft: "Up + left",
  fire: "Fire",
};

/**
 * The keypad edition's default: the four keys physically surrounding `8` on a
 * standard keypad grid, with fire in the middle. No diagonals — the keys that
 * would complete the diamond are `*` and `#`, both reserved, and whether the
 * target keypad reports two keys held at once is not knowable in advance.
 */
export const DIAMOND8_BINDING: JoystickKeyBinding = {
  up: "digit5",
  left: "digit7",
  right: "digit9",
  down: "digit0",
  fire: "digit8",
};

/** The arrangement the app shipped with: `2/4/6/8` cardinals, `1/3/7/9` diagonals, `5` fire. */
export const CLASSIC_T9_BINDING: JoystickKeyBinding = {
  up: "digit2",
  upRight: "digit3",
  right: "digit6",
  downRight: "digit9",
  down: "digit8",
  downLeft: "digit7",
  left: "digit4",
  upLeft: "digit1",
  fire: "digit5",
};

/**
 * A hardware D-pad steers whatever else is bound, and turns with the chassis in
 * the same way, so a device with both a D-pad and a keypad keeps both working.
 *
 * A slot may answer to more than one action because the D-pad's centre key does not
 * arrive as one thing. Measured on a Pixel 4, Android delivers `KEYCODE_DPAD_CENTER`
 * to the WebView as `key: "Enter"`, `keyCode: 13` and an EMPTY `code` — a DOM
 * `KeyboardEvent` carries the DOM key code, never the Android one — so the `keypad`
 * profile's `DpadCenter`/`23` bindings never match and the press resolves to `enter`.
 * With `fire` bound to `center` alone, the most natural fire button on the hardware
 * this feature exists for did nothing at all.
 *
 * Both are listed rather than one being rewritten into the other, because `center`
 * IS what a WebView that reports the named code sends, and a desktop keyboard's
 * Space still has to fire.
 */
const DPAD_BINDING: readonly { slot: JoystickSlot; actions: readonly SemanticAction[] }[] = [
  { slot: "up", actions: ["dpadUp"] },
  { slot: "down", actions: ["dpadDown"] },
  { slot: "left", actions: ["dpadLeft"] },
  { slot: "right", actions: ["dpadRight"] },
  { slot: "fire", actions: ["center", "enter"] },
];

/** Slots the always-on D-pad map drives for `action`. */
const dpadSlotsForAction = (action: SemanticAction): JoystickSlot[] =>
  DPAD_BINDING.filter((entry) => entry.actions.includes(action)).map((entry) => entry.slot);

/**
 * Actions that already do something inside the sheet and so may not be bound to a
 * joystick slot: `*`/Menu flips the view lock, `#` shows the quick keys and the
 * Live View switches, and Back leaves.
 */
export const RESERVED_ACTIONS: ReadonlySet<SemanticAction> = new Set<SemanticAction>([
  "star",
  "openMenu",
  "hash",
  "back",
]);

export const RESERVED_ACTION_ROLE: Partial<Record<SemanticAction, string>> = {
  star: "flips between driving the C64 and adjusting the view",
  openMenu: "flips between driving the C64 and adjusting the view",
  hash: "shows the quick keys and the Live View switches",
  back: "leaves Game Mode",
};

export const isReservedJoystickAction = (action: SemanticAction): boolean => RESERVED_ACTIONS.has(action);

/**
 * Turns a slot clockwise with the chassis. A key sits at a fixed place on the
 * handset, so turning the handset clockwise by `rotation` moves what that key
 * steers clockwise by the same amount. Fire is orientation-invariant.
 */
export const rotateSlot = (slot: JoystickSlot, rotation: DeviceRotation): JoystickSlot => {
  if (slot === "fire") return "fire";
  const index = DIRECTION_SLOTS.indexOf(slot);
  if (index < 0) return slot;
  const steps = rotation / 45;
  return DIRECTION_SLOTS[(index + steps) % DIRECTION_SLOTS.length];
};

const slotsForAction = (binding: JoystickKeyBinding, action: SemanticAction): JoystickSlot[] =>
  JOYSTICK_SLOTS.filter((slot) => binding[slot] === action);

/**
 * Which joystick inputs a physical key asserts, given the active binding and how
 * far the chassis is turned. The D-pad map is an always-on addition and rotates
 * under the same permutation.
 */
export const resolveJoystickInputs = (
  action: SemanticAction,
  binding: JoystickKeyBinding,
  rotation: DeviceRotation = 0,
): JoystickInputName[] => {
  if (isReservedJoystickAction(action)) return [];
  const slots = [...slotsForAction(binding, action), ...dpadSlotsForAction(action)];
  const inputs = new Set<JoystickInputName>();
  slots.forEach((slot) => {
    SLOT_INPUTS[rotateSlot(slot, rotation)].forEach((input) => inputs.add(input));
  });
  return [...inputs];
};

const LAYOUT_KEY = "c64u_remote_input_joystick_layout";
const BINDING_KEY = "c64u_remote_input_joystick_binding";

const JOYSTICK_LAYOUT_IDS: readonly JoystickLayoutId[] = ["diamond8", "classicT9", "custom"];

export const isJoystickLayoutId = (value: unknown): value is JoystickLayoutId =>
  typeof value === "string" && (JOYSTICK_LAYOUT_IDS as readonly string[]).includes(value);

export const DEFAULT_JOYSTICK_LAYOUT: JoystickLayoutId = isJoystickLayoutId(variant.runtime.defaultJoystickKeyLayout)
  ? variant.runtime.defaultJoystickKeyLayout
  : "classicT9";

export const JOYSTICK_LAYOUT_LABEL: Record<JoystickLayoutId, string> = {
  diamond8: "Diamond (8-centred)",
  classicT9: "Classic T9",
  custom: "Custom",
};

export const loadJoystickLayout = (): JoystickLayoutId => {
  if (typeof localStorage === "undefined") return DEFAULT_JOYSTICK_LAYOUT;
  const raw = localStorage.getItem(LAYOUT_KEY);
  return isJoystickLayoutId(raw) ? raw : DEFAULT_JOYSTICK_LAYOUT;
};

export const saveJoystickLayout = (layout: JoystickLayoutId): void => {
  if (typeof localStorage === "undefined") return;
  if (!isJoystickLayoutId(layout)) return;
  localStorage.setItem(LAYOUT_KEY, layout);
};

const isSemanticAction = (value: unknown): value is SemanticAction =>
  typeof value === "string" && (SEMANTIC_ACTIONS as readonly string[]).includes(value);

/**
 * Keeps only slot/action pairs that are structurally valid and not reserved, so a
 * hand-edited or partially-written entry degrades to the slots it got right
 * rather than to nothing at all.
 */
export const sanitiseJoystickBinding = (value: unknown): JoystickKeyBinding => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const binding: JoystickKeyBinding = {};
  JOYSTICK_SLOTS.forEach((slot) => {
    const action = source[slot];
    if (isSemanticAction(action) && !isReservedJoystickAction(action)) binding[slot] = action;
  });
  return binding;
};

export const loadCustomBinding = (): JoystickKeyBinding => {
  if (typeof localStorage === "undefined") return {};
  const raw = localStorage.getItem(BINDING_KEY);
  if (!raw) return {};
  try {
    return sanitiseJoystickBinding(JSON.parse(raw));
  } catch (error) {
    console.warn(`Discarding unreadable stored joystick binding at ${BINDING_KEY}`, error);
    return {};
  }
};

export const saveCustomBinding = (binding: JoystickKeyBinding): void => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(BINDING_KEY, JSON.stringify(sanitiseJoystickBinding(binding)));
};

export const bindingForLayout = (layout: JoystickLayoutId, custom: JoystickKeyBinding): JoystickKeyBinding => {
  if (layout === "diamond8") return DIAMOND8_BINDING;
  if (layout === "classicT9") return CLASSIC_T9_BINDING;
  return custom;
};

/**
 * Assigns an action to a slot, clearing it from any slot it previously held — one
 * key steering two directions at once is never what the user meant by pressing it.
 */
export const bindSlot = (
  binding: JoystickKeyBinding,
  slot: JoystickSlot,
  action: SemanticAction,
): JoystickKeyBinding => {
  const next: JoystickKeyBinding = {};
  JOYSTICK_SLOTS.forEach((candidate) => {
    const existing = binding[candidate];
    if (existing !== undefined && existing !== action) next[candidate] = existing;
  });
  next[slot] = action;
  return next;
};

export const clearSlot = (binding: JoystickKeyBinding, slot: JoystickSlot): JoystickKeyBinding => {
  const next = { ...binding };
  delete next[slot];
  return next;
};
