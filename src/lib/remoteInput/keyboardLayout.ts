/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ComponentType, CSSProperties } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "lucide-react";
import type { KeyboardInputName } from "@/lib/c64api";
import type { CursorDirection } from "@/lib/remoteInput/cursorKeyMapping";
import type { SpecialKeyboardKey } from "@/lib/remoteInput/specialKeyMapping";
import type { KeyboardProfile } from "@/lib/remoteInput/keyboardProfile";

/** A pictographic key glyph (e.g. a lucide arrow) rendered in place of a text label. */
export type KeyIcon = ComponentType<{ className?: string; style?: CSSProperties }>;

/**
 * The Type-tab keyboard as declarative data. Every profile (compact / medium /
 * expanded) is described with the SAME {@link KeyDef} vocabulary and the SAME
 * {@link KeyAction} set, so a given key dispatches identically no matter which
 * layout placed it — the layout varies, the behaviour does not (see
 * TypeKeyboard's single `dispatch` switch).
 */

/** The three latching modifiers; a latch applies to the next ordinary key, then clears. */
export type StickyModifier = "left_shift" | "commodore" | "ctrl";

/**
 * What a key does when pressed, resolved to exactly one shared session
 * dispatch method. This is the ONLY place layout meets behaviour:
 * - `char`     → `sendChar` (fallback-safe printable characters, e.g. SPACE/RETURN)
 * - `key`      → `sendKeyboardInputs` (a raw matrix chord; the active sticky
 *                modifier, if any, is appended by the caller)
 * - `cursor`   → `sendCursor` (keyboard cursor movement, NOT joystick)
 * - `special`  → `sendSpecialKey` (named/atomic keys: F1–F8, HOME/CLR, DEL/INS,
 *                RUN/STOP, RESTORE — including the atomic shifted halves)
 * - `modifier`   → toggles a local one-shot sticky latch (no transport call by itself)
 * - `shift_lock` → toggles a PERSISTENT shift: left_shift is appended to every
 *                  subsequent `key` chord until toggled off (no auto-clear)
 */
export type KeyAction =
  | { kind: "char"; char: string }
  | { kind: "key"; inputs: KeyboardInputName[] }
  | { kind: "cursor"; direction: CursorDirection }
  | { kind: "special"; key: SpecialKeyboardKey }
  | { kind: "modifier"; modifier: StickyModifier }
  | { kind: "shift_lock" };

/**
 * Visual/semantic tone — drives styling and caution treatment, never behaviour.
 * `character` colours the ordinary typing keys (0-9, A-Z); `shift` gives the
 * SHIFT / SHIFT LOCK keys their own high-visibility colour, distinct from the
 * other modifiers (C=, CTRL).
 */
export type KeyTone =
  | "default"
  | "action"
  | "edit"
  | "function"
  | "function-primary"
  | "modifier"
  | "shift"
  | "character"
  | "caution"
  | "danger";

export type KeyDef = {
  /** Stable id, unique within a layout (React key). */
  id: string;
  /** Full data-testid. */
  testId: string;
  /** Primary visual label. */
  label: string;
  /**
   * Optional pictographic glyph rendered INSTEAD of the text label (e.g. the
   * cursor arrows). The text `label` stays as a fallback and the `ariaLabel`
   * remains the source of truth for assistive tech.
   */
  icon?: KeyIcon;
  /** Shorter label used on compact where width is scarce (falls back to `label`). */
  compactLabel?: string;
  /**
   * Shifted-symbol legend shown as a small secondary keycap glyph, where
   * readable — ALWAYS requires SHIFT held while the key is tapped to reach
   * (the main `action` below is the unshifted function; holding SHIFT
   * composes it into the shifted one via the ordinary hold-chord relay, no
   * separate dispatch path needed).
   */
  secondary?: string;
  /**
   * Where the (smaller) secondary legend renders relative to the main label:
   * `"above"` (default) stacks it above, smaller — matching the digit/symbol
   * keys' existing convention and a real C64 keycap's shifted-legend
   * placement. `"right"` places it beside the main label instead (used only
   * by the merged function keys, where stacking two short "f N" labels read
   * as confusingly similar).
   */
  secondaryPosition?: "above" | "right";
  /**
   * Digit/symbol keys hide their secondary legend on the space-starved
   * `compact` profile (existing behaviour). High-value system/edit/cursor/
   * function keys set this so their ONLY way to discover the shifted
   * function is never hidden.
   */
  secondaryAlwaysVisible?: boolean;
  /**
   * By default the secondary legend renders muted/gray (matching the
   * existing digit-key convention, where the shifted symbol is a lesser
   * "bonus" hint). RUN/STOP is different: RUN and STOP are the SAME urgency
   * tier (both need the caution treatment to stay visible), so this opts
   * the secondary legend into inheriting the key's own tone colour (e.g.
   * `text-warning`) instead of being forced gray.
   */
  secondaryMatchesToneColor?: boolean;
  /**
   * The two merged expanded-profile cursor keys mirror a real C64 keycap
   * exactly: "CRSR" printed in the middle (the ordinary `label`, same size
   * as every other key) with a very small arrow above and another below,
   * centered and never overlapping the label. Mutually exclusive with
   * `secondary` — a dedicated field because this is a three-part stack
   * (arrow / label / arrow), not the two-part secondary-legend layout.
   */
  cursorArrows?: { above: string; below: string };
  /** Accessible label — always full and unambiguous, even when the visual label is abbreviated. */
  ariaLabel: string;
  action: KeyAction;
  tone?: KeyTone;
  /** Relative width weight within its row/group (1 = ordinary key). */
  span?: number;
  /** Keys with no kernal keyboard-buffer equivalent: disabled + hinted off the `full` tier. */
  requiresFullTier?: boolean;
};

/** Deck-based layout (compact & medium): a pinned high-value deck above a scrollable grid. */
export type KeyboardDeckLayout = {
  kind: "deck";
  /** RETURN / SPACE — immediate actions pinned beside the cursor pad. */
  immediate: KeyDef[];
  /** CLR / HOME / INS / DEL. */
  edit: KeyDef[];
  /** F1–F8. */
  functionKeys: KeyDef[];
  /** RUN/STOP, RESTORE, C=, CTRL, SHIFT. */
  system: KeyDef[];
  /** Scrollable alphanumeric / symbol grid (logical wrapping, not physical C64 rows). */
  grid: KeyDef[][];
  /** A bottom row pinned below the grid: SHIFT, a wide SPACE, and RETURN. */
  bottomRow: KeyDef[];
};

/** Row-based layout (expanded): the physical C64 rows rendered as closely as practical. */
export type KeyboardRowLayout = {
  kind: "rows";
  rows: KeyDef[][];
  /**
   * F1–F8 rendered as a bounded right-hand box (uniform width/height, shared X
   * origin), mirroring the physical C64's separate function-key cluster instead
   * of being appended to the ragged ends of the main rows.
   */
  functionKeys: KeyDef[];
};

export type KeyboardLayout = KeyboardDeckLayout | KeyboardRowLayout;

// --- Shared metadata --------------------------------------------------------

/**
 * Icon + accessible label for the keyboard cursor keys, shared by the CursorPad
 * and the expanded rows. Cursor keys render as clean lucide arrows (never "CUR"
 * text); their cross/D-pad arrangement plus the arrows make it clear they are
 * cursor controls, and the accessible label stays fully descriptive.
 */
export const CURSOR_KEY_META: Record<CursorDirection, { icon: KeyIcon; ariaLabel: string; testId: string }> = {
  up: { icon: ArrowUp, ariaLabel: "Cursor up", testId: "remote-input-key-cursor-up" },
  down: { icon: ArrowDown, ariaLabel: "Cursor down", testId: "remote-input-key-cursor-down" },
  left: { icon: ArrowLeft, ariaLabel: "Cursor left", testId: "remote-input-key-cursor-left" },
  right: { icon: ArrowRight, ariaLabel: "Cursor right", testId: "remote-input-key-cursor-right" },
};

// --- Key builders -----------------------------------------------------------

const letter = (c: string): KeyDef => ({
  id: c,
  testId: `remote-input-key-${c}`,
  label: c.toUpperCase(),
  ariaLabel: `Letter ${c.toUpperCase()}`,
  action: { kind: "key", inputs: [c as KeyboardInputName] },
  tone: "character",
});

const digit = (d: string, secondary?: string): KeyDef => ({
  id: d,
  testId: `remote-input-key-${d}`,
  label: d,
  secondary,
  ariaLabel: `Digit ${d}`,
  action: { kind: "key", inputs: [d as KeyboardInputName] },
  tone: "character",
});

type SymbolSpec = { key: KeyboardInputName; label: string; ariaLabel: string; secondary?: string };

const SYMBOLS: Record<string, SymbolSpec> = {
  plus: { key: "plus", label: "+", ariaLabel: "Plus" },
  minus: { key: "minus", label: "-", ariaLabel: "Minus" },
  pound: { key: "pound", label: "£", ariaLabel: "Pound" },
  at: { key: "at", label: "@", ariaLabel: "At" },
  star: { key: "star", label: "*", ariaLabel: "Star" },
  colon: { key: "colon", label: ":", ariaLabel: "Colon", secondary: "[" },
  semicolon: { key: "semicolon", label: ";", ariaLabel: "Semicolon", secondary: "]" },
  equals: { key: "equals", label: "=", ariaLabel: "Equals" },
  comma: { key: "comma", label: ",", ariaLabel: "Comma", secondary: "<" },
  period: { key: "period", label: ".", ariaLabel: "Period", secondary: ">" },
  slash: { key: "slash", label: "/", ariaLabel: "Slash", secondary: "?" },
};

const sym = (name: keyof typeof SYMBOLS): KeyDef => {
  const spec = SYMBOLS[name];
  return {
    id: name,
    testId: `remote-input-key-${spec.key}`,
    label: spec.label,
    secondary: spec.secondary,
    ariaLabel: spec.ariaLabel,
    action: { kind: "key", inputs: [spec.key] },
  };
};

// C64 character-arrow keys — labelled with the glyphs actually printed on the
// physical C64 keyboard ("←" left of "1", "↑" up by RESTORE). They stay distinct
// from the CURSOR movement keys by placement (these sit inline in the character
// grid) and rendering (the cursor keys use lucide arrow ICONS in a cross, these
// are text glyphs); their accessible labels spell out the difference explicitly.
const ARROW_LEFT: KeyDef = {
  id: "arrow_left",
  testId: "remote-input-key-arrow_left",
  label: "←",
  ariaLabel: "C64 left-arrow character key",
  action: { kind: "key", inputs: ["arrow_left"] },
};
const ARROW_UP: KeyDef = {
  id: "arrow_up",
  testId: "remote-input-key-arrow_up",
  label: "↑",
  ariaLabel: "C64 up-arrow character key",
  action: { kind: "key", inputs: ["arrow_up"] },
};

const RETURN: KeyDef = {
  id: "return",
  testId: "remote-input-key-return",
  label: "RETURN",
  ariaLabel: "Return",
  action: { kind: "char", char: "\n" },
  tone: "action",
  span: 2,
};
const SPACE: KeyDef = {
  id: "space",
  testId: "remote-input-key-space",
  label: "SPACE",
  ariaLabel: "Space",
  action: { kind: "char", char: " " },
  tone: "action",
  span: 2,
};
// A second, full-width SPACE anchored at the very bottom of the deck grid — the
// natural thumb position after typing a line, mirroring a physical keyboard.
// Distinct id/testid from the top SPACE so both stay unique.
const SPACE_BOTTOM: KeyDef = {
  ...SPACE,
  id: "space-bottom",
  testId: "remote-input-key-space-bottom",
  ariaLabel: "Space (bottom)",
};
// RETURN repeated to the right of the bottom SPACE (distinct id/testid).
const RETURN_BOTTOM: KeyDef = {
  ...RETURN,
  id: "return-bottom",
  testId: "remote-input-key-return-bottom",
  ariaLabel: "Return (bottom)",
  span: 1,
};

// Edit keys — split from the C64's dual-function physical keys into direct keys.
const HOME: KeyDef = {
  id: "home",
  testId: "remote-input-key-home",
  label: "HOME",
  ariaLabel: "Home",
  action: { kind: "special", key: "home" },
  tone: "edit",
};
const CLR: KeyDef = {
  id: "clr",
  testId: "remote-input-key-clr",
  label: "CLR",
  ariaLabel: "Clear",
  action: { kind: "special", key: "clr" },
  tone: "edit",
};
const DEL: KeyDef = {
  id: "del",
  testId: "remote-input-key-del",
  label: "DEL",
  ariaLabel: "Delete",
  action: { kind: "special", key: "del" },
  tone: "edit",
};
const INS: KeyDef = {
  id: "ins",
  testId: "remote-input-key-ins",
  label: "INST",
  ariaLabel: "Insert",
  action: { kind: "special", key: "ins" },
  tone: "edit",
};

const functionKey = (n: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8): KeyDef => {
  const key = `f${n}` as SpecialKeyboardKey;
  return {
    id: key,
    testId: `remote-input-key-${key}`,
    // Printed exactly as on the real C64 keycaps: a lower-case "f" and TWO
    // spaces before the number (f  1, f  3, ...). The gap uses non-breaking
    // spaces (U+00A0) because ordinary spaces collapse to one under the label's
    // `white-space: nowrap`. The odd (unshifted, front-labelled) keys get a
    // slightly darker fill so they stand apart from the shifted f  2 / f  4 /
    // f  6 / f  8 — see keyTone.ts `function-primary`.
    label: `f${"\u00a0\u00a0"}${n}`,
    ariaLabel: `f ${n}`,
    action: { kind: "special", key },
    tone: n % 2 === 1 ? "function-primary" : "function",
  };
};

// --- Expanded-profile-only merged dual-function keys ------------------------
//
// The real C64 keyboard has ONE physical key per pair below (matrix-wise,
// exactly as HOME/CLR and DEL/INST already model: the same raw matrix input,
// with SHIFT held distinguishing the two functions) — only the compact/medium
// decks render them as separate keys (room enough, and the CursorPad covers
// cursor movement there instead). The expanded profile mirrors the real
// keyboard's shape by rendering each pair as ONE key: tapping it sends the
// unshifted (main) function; holding SHIFT while tapping composes the
// shifted (secondary) function via the ordinary hold-chord relay — no new
// dispatch path is needed for either half.
const CLR_HOME_MERGED: KeyDef = {
  id: "clr-home",
  testId: "remote-input-key-clr-home",
  label: "HOME",
  secondary: "CLR",
  secondaryAlwaysVisible: true,
  ariaLabel: "Home (hold Shift for Clear)",
  action: { kind: "special", key: "home" },
  tone: "edit",
};
const INST_DEL_MERGED: KeyDef = {
  id: "inst-del",
  testId: "remote-input-key-inst-del",
  label: "DEL",
  secondary: "INST",
  secondaryAlwaysVisible: true,
  ariaLabel: "Delete (hold Shift for Insert)",
  action: { kind: "special", key: "del" },
  tone: "edit",
};
// The C64's cursor keys are matrix-wise exactly like HOME/CLR above: ONE key
// per axis, unshifted = down/right, SHIFT = up/left (see cursorKeyMapping.ts).
// The real keycap prints "CRSR" in the middle with a small arrow above and
// another below - `cursorArrows` reproduces that exactly (see
// KeyboardKeyButtonImpl's dedicated render branch), not the CursorPad's
// lucide icons or the generic secondary-legend mechanism.
// Kept as `{kind:"cursor", direction}` (same action kind, same onCursor/
// sendCursor path the standalone cursor keys always used - fallback-tier
// PETSCII injection works per-direction with no shift composition needed,
// see cursorKeyMapping.ts) rather than a raw matrix "key" input: the
// unshifted direction is the default action, and TypeKeyboard's tap handler
// picks the complementary (shifted) direction when SHIFT is currently
// asserted, entirely at the UI layer - no new dispatch path required.
const CURSOR_UP_DOWN_MERGED: KeyDef = {
  id: "cursor-up-down",
  testId: "remote-input-key-cursor-up-down",
  label: "CRSR",
  ariaLabel: "Cursor down (hold Shift for up)",
  action: { kind: "cursor", direction: "down" },
  tone: "default",
  cursorArrows: { above: "↑", below: "↓" },
};
const CURSOR_LEFT_RIGHT_MERGED: KeyDef = {
  id: "cursor-left-right",
  testId: "remote-input-key-cursor-left-right",
  label: "CRSR",
  ariaLabel: "Cursor right (hold Shift for left)",
  action: { kind: "cursor", direction: "right" },
  cursorArrows: { above: "←", below: "→" },
  tone: "default",
};

// Merged F-key pair (F1/F2, F3/F4, F5/F6, F7/F8): unlike the keys above, the
// two legends sit SIDE BY SIDE (main then smaller secondary to the right) —
// stacking two near-identical "f N" labels vertically reads as confusingly
// similar.
const expandedFunctionKeyPair = (main: 1 | 3 | 5 | 7): KeyDef => {
  const mainKey = `f${main}` as SpecialKeyboardKey;
  const secondaryN = main + 1;
  const secondaryKey = `f${secondaryN}` as SpecialKeyboardKey;
  return {
    id: `${mainKey}-${secondaryKey}`,
    testId: `remote-input-key-${mainKey}-${secondaryKey}`,
    label: `f${"  "}${main}`,
    secondary: `f${"  "}${secondaryN}`,
    secondaryPosition: "right",
    secondaryAlwaysVisible: true,
    ariaLabel: `f ${main} (hold Shift for f ${secondaryN})`,
    action: { kind: "special", key: mainKey },
    tone: "function-primary",
  };
};
const EXPANDED_FUNCTION_GROUP: KeyDef[] = [
  expandedFunctionKeyPair(1),
  expandedFunctionKeyPair(3),
  expandedFunctionKeyPair(5),
  expandedFunctionKeyPair(7),
];

const RUN_STOP: KeyDef = {
  id: "run_stop",
  testId: "remote-input-key-run-stop",
  // STOP is the unshifted (main) function; RUN is SHIFT+RUN/STOP - a real C64
  // shortcut that loads and runs, sent by holding SHIFT while tapping this
  // same key (the ordinary hold-chord relay composes run_stop+left_shift on
  // the wire; no separate dispatch path exists or is needed for "RUN").
  label: "STOP",
  secondary: "RUN",
  secondaryAlwaysVisible: true,
  // RUN and STOP are the same caution-tier action - both must read as the
  // warning colour, never one coloured and the other muted gray.
  secondaryMatchesToneColor: true,
  ariaLabel: "Run Stop",
  action: { kind: "special", key: "run_stop" },
  tone: "caution",
  requiresFullTier: true,
};
const RESTORE: KeyDef = {
  id: "restore",
  testId: "remote-input-key-restore",
  // Full word everywhere, including the expanded profile: RESTORE is now
  // double-width there (span: RESTORE_SPAN below), so it no longer needs the
  // "REST." abbreviation the dense expanded grid used to require.
  label: "RESTORE",
  ariaLabel: "Restore",
  action: { kind: "special", key: "restore" },
  tone: "danger",
  requiresFullTier: true,
};
const COMMODORE: KeyDef = {
  id: "commodore",
  testId: "remote-input-key-commodore",
  // No Commodore logo asset exists in the app's icon set, so the universally
  // recognised "C=" ASCII rendering of the key face is used as the visible label.
  label: "C=",
  ariaLabel: "Commodore key",
  action: { kind: "modifier", modifier: "commodore" },
  tone: "modifier",
  requiresFullTier: true,
};
const CTRL: KeyDef = {
  id: "ctrl",
  testId: "remote-input-key-ctrl",
  label: "CTRL",
  ariaLabel: "Control",
  action: { kind: "modifier", modifier: "ctrl" },
  tone: "modifier",
  requiresFullTier: true,
};
const SHIFT: KeyDef = {
  id: "shift",
  testId: "remote-input-key-shift",
  label: "SHIFT",
  ariaLabel: "Shift",
  action: { kind: "modifier", modifier: "left_shift" },
  tone: "shift",
};
// The expanded physical layout has two Shift keys; the right one latches the
// same sticky shift but needs its own id/testid to stay unique.
const SHIFT_RIGHT: KeyDef = {
  ...SHIFT,
  id: "shift-right",
  testId: "remote-input-key-shift-right",
  ariaLabel: "Shift (right)",
};
// SHIFT LOCK — a persistent shift toggle, ideal on touch devices where holding
// SHIFT is awkward. Unlike the one-shot SHIFT it stays latched, applying
// left_shift to every subsequent key until tapped again. Placed to the right of
// RUN/STOP. Two-line face ("SHIFT" over "LOCK") mirrors the physical keycap.
const SHIFT_LOCK: KeyDef = {
  id: "shift-lock",
  testId: "remote-input-key-shift-lock",
  label: "SHIFT\nLOCK",
  // "SHIFT" no longer fits on one line in the expanded row once its neighbour
  // RETURN doubles in width (HARD16-008-style abbreviation, same mechanism
  // RESTORE already uses for the same dense row).
  compactLabel: "SHFT\nLOCK",
  ariaLabel: "Shift lock",
  action: { kind: "shift_lock" },
  tone: "shift",
};
// A second SHIFT to the LEFT of the bottom SPACE (distinct id/testid; same
// latch behaviour and colour as the SHIFT above the grid).
const SHIFT_BOTTOM: KeyDef = {
  ...SHIFT,
  id: "shift-bottom",
  testId: "remote-input-key-shift-bottom",
  ariaLabel: "Shift (bottom)",
};

// Secondary legends for the number row (authentic C64 shifted symbols).
const NUMBER_ROW_SECONDARY: Record<string, string> = {
  "1": "!",
  "2": '"',
  "3": "#",
  "4": "$",
  "5": "%",
  "6": "&",
  "7": "'",
  "8": "(",
  "9": ")",
};
const num = (d: string): KeyDef => digit(d, NUMBER_ROW_SECONDARY[d]);

// --- Deck groups (shared by compact & medium) -------------------------------

const IMMEDIATE_GROUP: KeyDef[] = [RETURN, SPACE];
const EDIT_GROUP: KeyDef[] = [CLR, HOME, INS, DEL];
const FUNCTION_GROUP: KeyDef[] = [
  functionKey(1),
  functionKey(2),
  functionKey(3),
  functionKey(4),
  functionKey(5),
  functionKey(6),
  functionKey(7),
  functionKey(8),
];
const SYSTEM_GROUP: KeyDef[] = [RUN_STOP, SHIFT_LOCK, RESTORE, COMMODORE, CTRL, SHIFT];
// Bottom row: SHIFT (left) — wide SPACE — RETURN (right).
const BOTTOM_ROW: KeyDef[] = [SHIFT_BOTTOM, SPACE_BOTTOM, RETURN_BOTTOM];

// --- Profile layouts --------------------------------------------------------

// HARD16-007 segment invariant: every rendered grid row is a CONTIGUOUS slice
// of exactly ONE physical C64 keyboard row (order preserved), so row membership
// is predictable at any key size — no full-row wrapping that splits QWERTY
// mid-row, and no horizontal scrolling. The true C64 rows (minus keys already
// extracted to the deck's edit/system/immediate/cursor groups) are:
//   row 1: ← 1 2 3 4 5 6 7 8 9 0 + - £
//   row 2: Q W E R T Y U I O P @ * ↑
//   row 3: A S D F G H J K L : ; =
//   row 4: Z X C V B N M , . /
// Shared by compact AND medium (same model, different key sizes); expanded
// renders the authentic full rows instead.
const DECK_GRID: KeyDef[][] = [
  [ARROW_LEFT, num("1"), num("2"), num("3"), num("4"), num("5")],
  [num("6"), num("7"), num("8"), num("9"), digit("0")],
  [sym("plus"), sym("minus"), sym("pound")],
  [letter("q"), letter("w"), letter("e"), letter("r"), letter("t"), letter("y")],
  [letter("u"), letter("i"), letter("o"), letter("p")],
  [sym("at"), sym("star"), ARROW_UP],
  [letter("a"), letter("s"), letter("d"), letter("f"), letter("g")],
  [letter("h"), letter("j"), letter("k"), letter("l")],
  [sym("colon"), sym("semicolon"), sym("equals")],
  [letter("z"), letter("x"), letter("c"), letter("v"), letter("b")],
  [letter("n"), letter("m"), sym("comma"), sym("period"), sym("slash")],
];

// The expanded profile reproduces a real C64 keyboard's exact geometry,
// measured off a physical unit (breadbin). Widths are in KEY UNITS (1u = one
// ordinary letter/number key). EVERY main row totals exactly the same
// EXPANDED_ROW_UNITS so a `span`-N key is the SAME pixel width in whatever row
// it appears, and the columns line up between rows:
//   row 1: ← 1 2 3 4 5 6 7 8 9 0 + - £ HOME DEL        (16 × 1u)
//   row 2: CTRL(1.5) Q..P @ * ↑ (13 × 1u) RESTORE(1.5) (= 16u)
//   row 3: RUN/STOP(1) SHIFT-LOCK(1) A..L : ; = (12 × 1u) RETURN(2) (= 16u)
//   row 4: C=(1) SHIFT(1.5) Z..M , . / (10 × 1u) SHIFT(1.5) CRSR(1) CRSR(1) (= 16u)
// The function-key cluster and the gap to it (right of the main rows) are also
// authentic-width; exported so TypeKeyboard.tsx sizes that separate flex
// column with the same unit basis instead of magic pixel numbers.
export const EXPANDED_ROW_UNITS = 16;
export const EXPANDED_FUNCTION_UNITS = 3; // each merged f-key pair is ~3u wide on a real C64
export const EXPANDED_FUNCTION_GAP_UNITS = 0.85; // gap between the main rows and the f-key cluster

const CTRL_SPAN = 1.5;
const RESTORE_SPAN = 1.5;
const SHIFT_SPAN = 1.5;
// RETURN spans 2 units. Its width is additionally nudged to the two merged
// CRSR keys' COMBINED width (2u + the gap between them) in TypeKeyboard so its
// left edge lands flush with the left CRSR key beneath it; this 2 is the
// pre-measurement fallback span.
const RETURN_SPAN = 2;

// The SPACE bar starts below the middle of Z and ends where "." ends, exactly
// like a real C64 keyboard. In the 16u row-4 grid Z occupies [2.5,3.5] (middle
// 3.0) and "." occupies [10.5,11.5] (right edge 11.5): leading 3.0, bar 8.5,
// trailing 4.5 (= 16u). Leading/trailing spacer <div>s (not real keys) carry
// the width either side — see the expanded row rendering in TypeKeyboard.tsx.
export const SPACE_ROW_LEADING_SPAN = 3;
export const SPACE_ROW_SPAN = 8.5;
export const SPACE_ROW_TRAILING_SPAN = 4.5;

const EXPANDED_ROWS: KeyDef[][] = [
  [
    ARROW_LEFT,
    num("1"),
    num("2"),
    num("3"),
    num("4"),
    num("5"),
    num("6"),
    num("7"),
    num("8"),
    num("9"),
    digit("0"),
    sym("plus"),
    sym("minus"),
    sym("pound"),
    CLR_HOME_MERGED,
    INST_DEL_MERGED,
  ],
  [
    { ...CTRL, span: CTRL_SPAN },
    letter("q"),
    letter("w"),
    letter("e"),
    letter("r"),
    letter("t"),
    letter("y"),
    letter("u"),
    letter("i"),
    letter("o"),
    letter("p"),
    sym("at"),
    sym("star"),
    ARROW_UP,
    { ...RESTORE, span: RESTORE_SPAN },
  ],
  [
    RUN_STOP,
    SHIFT_LOCK,
    letter("a"),
    letter("s"),
    letter("d"),
    letter("f"),
    letter("g"),
    letter("h"),
    letter("j"),
    letter("k"),
    letter("l"),
    sym("colon"),
    sym("semicolon"),
    sym("equals"),
    { ...RETURN, span: RETURN_SPAN },
  ],
  [
    COMMODORE,
    { ...SHIFT, span: SHIFT_SPAN },
    letter("z"),
    letter("x"),
    letter("c"),
    letter("v"),
    letter("b"),
    letter("n"),
    letter("m"),
    sym("comma"),
    sym("period"),
    sym("slash"),
    { ...SHIFT_RIGHT, span: SHIFT_SPAN },
    CURSOR_UP_DOWN_MERGED,
    CURSOR_LEFT_RIGHT_MERGED,
  ],
  [{ ...SPACE, span: SPACE_ROW_SPAN }],
];

export const getKeyboardLayout = (profile: KeyboardProfile): KeyboardLayout => {
  switch (profile) {
    case "compact":
    case "medium":
      return {
        kind: "deck",
        immediate: IMMEDIATE_GROUP,
        edit: EDIT_GROUP,
        functionKeys: FUNCTION_GROUP,
        system: SYSTEM_GROUP,
        grid: DECK_GRID,
        bottomRow: BOTTOM_ROW,
      };
    case "expanded":
      return { kind: "rows", rows: EXPANDED_ROWS, functionKeys: EXPANDED_FUNCTION_GROUP };
  }
};

/** Flattens a layout to the full set of {@link KeyDef}s it renders (cursor-pad keys excluded — see below). */
export const flattenLayoutKeys = (layout: KeyboardLayout): KeyDef[] =>
  layout.kind === "deck"
    ? [
        ...layout.immediate,
        ...layout.edit,
        ...layout.functionKeys,
        ...layout.system,
        ...layout.grid.flat(),
        ...layout.bottomRow,
      ]
    : [...layout.rows.flat(), ...layout.functionKeys];

/** The four cursor directions in stable order — used to build the CursorPad and expanded cursor keys. */
export const CURSOR_DIRECTIONS: readonly CursorDirection[] = ["up", "down", "left", "right"];
