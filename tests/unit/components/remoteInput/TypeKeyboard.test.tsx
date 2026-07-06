/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TypeKeyboard, type TypeKeyboardProps, type TypeKeyboardTier } from "@/components/remoteInput/TypeKeyboard";
import { EMPTY_HELD_KEYBOARD_INPUTS } from "@/lib/remoteInput/keyboardHeldSet";
import type { HeldKeyboardInputs } from "@/lib/remoteInput/keyboardHeldSet";
import type { KeyboardProfile } from "@/lib/remoteInput/keyboardProfile";

const PROFILES: KeyboardProfile[] = ["compact", "medium", "expanded"];

const makeHandlers = () => ({
  onChar: vi.fn(),
  onKey: vi.fn(),
  onCursor: vi.fn(),
  onSpecialKey: vi.fn(),
});

/** Wires a real held-keyboard-inputs state, mirroring what useRemoteInputSession provides. */
const TypeKeyboardHarness = (
  props: Omit<TypeKeyboardProps, "heldKeyboardInputs" | "onHeldKeyboardInputsChange"> & {
    onHeldChange?: (next: HeldKeyboardInputs) => void;
  },
) => {
  const { onHeldChange, ...rest } = props;
  const [held, setHeld] = useState<HeldKeyboardInputs>(EMPTY_HELD_KEYBOARD_INPUTS);
  return (
    <TypeKeyboard
      {...rest}
      heldKeyboardInputs={held}
      onHeldKeyboardInputsChange={(next) => {
        onHeldChange?.(next);
        setHeld(next);
      }}
    />
  );
};

const renderKeyboard = (profile: KeyboardProfile, tier: TypeKeyboardTier = "full") => {
  const handlers: Pick<TypeKeyboardProps, "onChar" | "onKey" | "onCursor" | "onSpecialKey"> = makeHandlers();
  render(<TypeKeyboardHarness {...handlers} tier={tier} profile={profile} />);
  return handlers as ReturnType<typeof makeHandlers>;
};

const renderKeyboardWithSnapshots = (profile: KeyboardProfile, tier: TypeKeyboardTier = "full") => {
  const handlers: Pick<TypeKeyboardProps, "onChar" | "onKey" | "onCursor" | "onSpecialKey"> = makeHandlers();
  const snapshots: string[][] = [];
  render(
    <TypeKeyboardHarness
      {...handlers}
      tier={tier}
      profile={profile}
      onHeldChange={(next) => snapshots.push([...next].sort())}
    />,
  );
  return { ...(handlers as ReturnType<typeof makeHandlers>), snapshots };
};

// Every direct high-value virtual key that must exist on the compact/medium
// decks (cursor movement comes from the CursorPad there, tested separately).
const HIGH_VALUE_TEST_IDS = [
  "remote-input-key-cursor-up",
  "remote-input-key-cursor-down",
  "remote-input-key-cursor-left",
  "remote-input-key-cursor-right",
  "remote-input-key-return",
  "remote-input-key-space",
  "remote-input-key-clr",
  "remote-input-key-home",
  "remote-input-key-ins",
  "remote-input-key-del",
  "remote-input-key-f1",
  "remote-input-key-f2",
  "remote-input-key-f3",
  "remote-input-key-f4",
  "remote-input-key-f5",
  "remote-input-key-f6",
  "remote-input-key-f7",
  "remote-input-key-f8",
  "remote-input-key-run-stop",
  "remote-input-key-restore",
  "remote-input-key-commodore",
  "remote-input-key-ctrl",
  "remote-input-key-shift",
  "remote-input-key-shift-lock",
];

// The expanded profile mirrors a real C64 keyboard's shape: HOME/CLR,
// DEL/INST, each cursor axis, and each F-key pair are ONE physical key.
const EXPANDED_HIGH_VALUE_TEST_IDS = [
  "remote-input-key-cursor-up-down",
  "remote-input-key-cursor-left-right",
  "remote-input-key-return",
  "remote-input-key-space",
  "remote-input-key-clr-home",
  "remote-input-key-inst-del",
  "remote-input-key-f1-f2",
  "remote-input-key-f3-f4",
  "remote-input-key-f5-f6",
  "remote-input-key-f7-f8",
  "remote-input-key-run-stop",
  "remote-input-key-restore",
  "remote-input-key-commodore",
  "remote-input-key-ctrl",
  "remote-input-key-shift",
  "remote-input-key-shift-lock",
];

describe("TypeKeyboard", () => {
  afterEach(() => cleanup());

  describe("profile selection", () => {
    it.each(PROFILES)("renders the %s layout when that profile is resolved", (profile) => {
      renderKeyboard(profile);
      expect(screen.getByTestId("remote-input-type-keyboard")).toHaveAttribute("data-profile", profile);
    });

    it("uses a pinned deck for compact and medium", () => {
      renderKeyboard("compact");
      expect(screen.getByTestId("remote-input-keyboard-deck")).toBeInTheDocument();
      cleanup();
      renderKeyboard("medium");
      expect(screen.getByTestId("remote-input-keyboard-deck")).toBeInTheDocument();
    });

    it("uses physical rows (no separate deck) for expanded", () => {
      renderKeyboard("expanded");
      expect(screen.queryByTestId("remote-input-keyboard-deck")).toBeNull();
      expect(screen.getByTestId("remote-input-keyboard-grid")).toBeInTheDocument();
    });

    it("renders the expanded function keys inside their own bounded box", () => {
      renderKeyboard("expanded");
      const box = screen.getByTestId("remote-input-keyboard-function");
      for (const f of ["f1-f2", "f3-f4", "f5-f6", "f7-f8"]) {
        expect(within(box).getByTestId(`remote-input-key-${f}`)).toBeInTheDocument();
      }
    });

    it("defaults to medium when the content box has not been measured (no override)", () => {
      const handlers = makeHandlers();
      render(<TypeKeyboardHarness {...handlers} tier="full" />);
      expect(screen.getByTestId("remote-input-type-keyboard")).toHaveAttribute("data-profile", "medium");
    });

    it.each(["compact", "medium"] as const)(
      "splits the function keys and the system keys into two rows on %s",
      (profile) => {
        renderKeyboard(profile);
        expect(screen.getByTestId("remote-input-keyboard-function").children.length).toBe(2);
        expect(
          within(screen.getByTestId("remote-input-keyboard-function")).getByTestId("remote-input-key-f8"),
        ).toBeInTheDocument();
        // System keys split RUN/STOP·SHIFT-LOCK·RESTORE / C=·CTRL·SHIFT.
        expect(screen.getByTestId("remote-input-keyboard-system").children.length).toBe(2);
      },
    );

    it("renders a SHIFT | SPACE | RETURN bottom row (SPACE/RETURN/SHIFT appear twice)", () => {
      renderKeyboard("compact");
      const bottom = screen.getByTestId("remote-input-keyboard-bottom-row");
      expect(within(bottom).getByTestId("remote-input-key-shift-bottom")).toBeInTheDocument();
      expect(within(bottom).getByTestId("remote-input-key-space-bottom")).toBeInTheDocument();
      expect(within(bottom).getByTestId("remote-input-key-return-bottom")).toBeInTheDocument();
      // The top immediate SPACE/RETURN and the system SHIFT are still present too.
      expect(screen.getByTestId("remote-input-key-space")).toBeInTheDocument();
      expect(screen.getByTestId("remote-input-key-return")).toBeInTheDocument();
      expect(screen.getByTestId("remote-input-key-shift")).toBeInTheDocument();
    });
  });

  describe("high-value key visibility", () => {
    it.each(["compact", "medium"] as const)("exposes every high-value direct virtual key in the %s profile", (profile) => {
      renderKeyboard(profile);
      for (const testId of HIGH_VALUE_TEST_IDS) {
        expect(screen.getByTestId(testId), `${profile} missing ${testId}`).toBeInTheDocument();
      }
    });

    it("exposes every high-value direct virtual key (merged pairs included) in the expanded profile", () => {
      renderKeyboard("expanded");
      for (const testId of EXPANDED_HIGH_VALUE_TEST_IDS) {
        expect(screen.getByTestId(testId), `expanded missing ${testId}`).toBeInTheDocument();
      }
    });
  });

  describe("compact deck + grid scrolling", () => {
    it("scrolls the whole keyboard (deck + grid) in one container so no key is stranded off-screen", () => {
      renderKeyboard("compact");
      const scroll = screen.getByTestId("remote-input-keyboard-scroll");
      const deck = screen.getByTestId("remote-input-keyboard-deck");
      const grid = screen.getByTestId("remote-input-keyboard-grid");

      // The cursor pad + immediate RETURN/SPACE keep their high-value deck grouping...
      expect(within(deck).getByTestId("remote-input-cursor-pad")).toBeInTheDocument();
      expect(within(deck).getByTestId("remote-input-key-return")).toBeInTheDocument();
      expect(within(deck).getByTestId("remote-input-key-space")).toBeInTheDocument();

      // ...but the whole keyboard now scrolls together: ONE scroll container holds
      // both the deck and the grid (rather than pinning the deck and scrolling only
      // the sliver beneath it).
      expect(scroll.className).toMatch(/overflow-y-auto/);
      expect(scroll.contains(deck)).toBe(true);
      expect(scroll.contains(grid)).toBe(true);
      // The grid stays a distinct group and never duplicates the deck controls.
      expect(grid.contains(deck)).toBe(false);
      expect(within(grid).queryByTestId("remote-input-cursor-pad")).toBeNull();
      expect(within(grid).queryByTestId("remote-input-key-return")).toBeNull();
    });
  });

  describe("shared atomic dispatch", () => {
    it("taps the unshifted (main) half of each merged expanded key directly", () => {
      const h = renderKeyboardWithSnapshots("expanded");
      const cases: Array<[string, string]> = [
        ["remote-input-key-clr-home", "clr_home"],
        ["remote-input-key-inst-del", "inst_del"],
        ["remote-input-key-f1-f2", "f1"],
        ["remote-input-key-f3-f4", "f3"],
        ["remote-input-key-f5-f6", "f5"],
        ["remote-input-key-f7-f8", "f7"],
      ];
      for (const [testId, input] of cases) {
        fireEvent.click(screen.getByTestId(testId));
        expect(h.snapshots, testId).toContainEqual([input]);
      }
      expect(h.onSpecialKey).not.toHaveBeenCalled();
    });

    it("reaches the shifted (secondary) half of each merged expanded key by HOLDING SHIFT while tapping it", () => {
      // Full tier relays every key via real press/release (see
      // useKeyboardHoldDispatch), not the one-shot onSpecialKey tap prop —
      // that prop is now reserved for the kernal-fallback tier. There is no
      // latch: SHIFT must be physically HELD (pointer down) while the merged
      // key is tapped, composing the same wire chord a real hold-and-chord
      // would, and it is released the instant SHIFT's pointer lifts.
      const h = renderKeyboardWithSnapshots("expanded");
      const cases: Array<[string, string[]]> = [
        ["remote-input-key-clr-home", ["clr_home", "left_shift"]],
        ["remote-input-key-inst-del", ["inst_del", "left_shift"]],
        ["remote-input-key-f1-f2", ["f1", "left_shift"]],
        ["remote-input-key-f3-f4", ["f3", "left_shift"]],
        ["remote-input-key-f5-f6", ["f5", "left_shift"]],
        ["remote-input-key-f7-f8", ["f7", "left_shift"]],
      ];
      const shift = screen.getByTestId("remote-input-key-shift");
      for (const [testId, inputs] of cases) {
        fireEvent.pointerDown(shift, { pointerId: 1 });
        fireEvent.click(screen.getByTestId(testId));
        expect(h.snapshots, testId).toContainEqual([...inputs].sort());
        fireEvent.pointerUp(shift, { pointerId: 1 });
        // SHIFT is released with its pointer; it never stays stuck.
        expect(h.snapshots.at(-1), testId).toEqual([]);
      }
      expect(h.onSpecialKey).not.toHaveBeenCalled();
    });

    it("dispatches CURSOR_UP and CURSOR_LEFT as keyboard cursor movement", () => {
      const h = renderKeyboard("medium");
      fireEvent.click(screen.getByTestId("remote-input-key-cursor-up"));
      expect(h.onCursor).toHaveBeenCalledWith("up");
      fireEvent.click(screen.getByTestId("remote-input-key-cursor-left"));
      expect(h.onCursor).toHaveBeenCalledWith("left");
    });

    it("resolves the expanded profile's merged cursor keys to the unshifted direction by default, and the shifted one while SHIFT is HELD", () => {
      const h = renderKeyboard("expanded");
      fireEvent.click(screen.getByTestId("remote-input-key-cursor-up-down"));
      expect(h.onCursor).toHaveBeenLastCalledWith("down");
      fireEvent.click(screen.getByTestId("remote-input-key-cursor-left-right"));
      expect(h.onCursor).toHaveBeenLastCalledWith("right");

      // Holding SHIFT (pointer down, not released) stays active across cursor
      // taps: cursor keys bypass the ordinary held-set relay entirely (see
      // handleKeyTap's cursor branch) and simply read whether SHIFT is
      // currently held. Both merged cursor keys reach their shifted direction
      // from the SAME single held SHIFT.
      const shift = screen.getByTestId("remote-input-key-shift");
      fireEvent.pointerDown(shift, { pointerId: 1 });
      fireEvent.click(screen.getByTestId("remote-input-key-cursor-up-down"));
      expect(h.onCursor).toHaveBeenLastCalledWith("up");
      fireEvent.click(screen.getByTestId("remote-input-key-cursor-left-right"));
      expect(h.onCursor).toHaveBeenLastCalledWith("left");
      fireEvent.pointerUp(shift, { pointerId: 1 });

      // Once SHIFT is released, cursor taps revert to the unshifted direction.
      fireEvent.click(screen.getByTestId("remote-input-key-cursor-up-down"));
      expect(h.onCursor).toHaveBeenLastCalledWith("down");
    });

    it("shifts the next key only while SHIFT is HELD, and a bare SHIFT tap does not latch onto it", () => {
      const h = renderKeyboardWithSnapshots("medium");
      const shift = screen.getByTestId("remote-input-key-shift");

      // Holding SHIFT while tapping "a" composes a real simultaneous chord.
      fireEvent.pointerDown(shift, { pointerId: 1 });
      expect(shift).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(screen.getByTestId("remote-input-key-a"));
      expect(h.snapshots).toContainEqual(["a", "left_shift"]);
      fireEvent.pointerUp(shift, { pointerId: 1 });
      expect(h.snapshots.at(-1)).toEqual([]);
      expect(shift).toHaveAttribute("aria-pressed", "false");

      // Regression: a BARE SHIFT tap must not latch onto the next key.
      h.snapshots.length = 0;
      fireEvent.click(shift); // tap: press+release, no latch
      expect(shift).toHaveAttribute("aria-pressed", "false");
      fireEvent.click(screen.getByTestId("remote-input-key-a"));
      expect(h.snapshots).toContainEqual(["a"]);
      expect(h.snapshots).not.toContainEqual(["a", "left_shift"]);
    });

    it("never leaves SHIFT stuck after a held chord (no modifier leak)", () => {
      const h = renderKeyboardWithSnapshots("expanded");
      const shift = screen.getByTestId("remote-input-key-shift");

      // Hold SHIFT, tap the merged CLR/HOME key to reach its shifted (CLR)
      // half via the ordinary hold-chord relay, then release SHIFT. Nothing
      // must linger, and it must not go through onKey/onSpecialKey.
      fireEvent.pointerDown(shift, { pointerId: 1 });
      expect(shift).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(screen.getByTestId("remote-input-key-clr-home"));
      expect(h.snapshots).toContainEqual(["clr_home", "left_shift"]);
      fireEvent.pointerUp(shift, { pointerId: 1 });
      expect(h.snapshots.at(-1)).toEqual([]);
      expect(h.onSpecialKey).not.toHaveBeenCalled();
      expect(h.onKey).not.toHaveBeenCalled();
      expect(shift).toHaveAttribute("aria-pressed", "false");
    });
  });

  describe("cursor safety", () => {
    it.each(["compact", "medium"] as const)(
      "isolates the cursor pad from edit/system/modifier keys in the %s profile",
      (profile) => {
        renderKeyboard(profile);
        const pad = screen.getByTestId("remote-input-cursor-pad");

        // Only the four cursor keys live inside the pad.
        expect(within(pad).getAllByRole("button")).toHaveLength(4);
        for (const forbidden of ["ctrl", "shift", "commodore", "ins", "del", "restore", "run-stop"]) {
          expect(within(pad).queryByTestId(`remote-input-key-${forbidden}`)).toBeNull();
        }

        // Those keys live in sibling groups, never inside the cursor pad.
        const editGroup = screen.getByTestId("remote-input-keyboard-edit");
        const systemGroup = screen.getByTestId("remote-input-keyboard-system");
        const ins = within(editGroup).getByTestId("remote-input-key-ins");
        const ctrl = within(systemGroup).getByTestId("remote-input-key-ctrl");
        expect(pad.contains(ins)).toBe(false);
        expect(pad.contains(ctrl)).toBe(false);
      },
    );

    it("gives compact cursor keys a larger hit target than ordinary grid keys", () => {
      renderKeyboard("compact");
      const cellSizePx = Number(screen.getByTestId("remote-input-cursor-pad").getAttribute("data-cell-size"));
      const gridKeyHeightPx = Number(screen.getByTestId("remote-input-key-q").getAttribute("data-key-height"));
      expect(cellSizePx).toBeGreaterThan(gridKeyHeightPx);
    });
  });

  describe("character-arrow vs cursor distinction", () => {
    it("keeps the C64 arrow-left character key distinct from the merged CURSOR left/right key", () => {
      const h = renderKeyboardWithSnapshots("expanded");
      fireEvent.click(screen.getByTestId("remote-input-key-arrow_left"));
      expect(h.snapshots).toContainEqual(["arrow_left"]);
      expect(h.onCursor).not.toHaveBeenCalled();

      // Tapping the merged cursor key alone gives its unshifted (main)
      // direction, right - "left" needs SHIFT held (see the merged-cursor
      // test in "shared atomic dispatch").
      fireEvent.click(screen.getByTestId("remote-input-key-cursor-left-right"));
      expect(h.onCursor).toHaveBeenCalledWith("right");

      const arrowLeft = screen.getByTestId("remote-input-key-arrow_left");
      expect(arrowLeft).toHaveAttribute("aria-label", "C64 left-arrow character key");
      // Visible label is the authentic printed glyph, never "ARW".
      expect(arrowLeft.textContent).toBe("←");
      expect(arrowLeft.textContent).not.toMatch(/ARW/i);
      // The merged cursor key renders plain arrow glyphs (no "CUR" text) and stays distinct.
      const cursorLeftRight = screen.getByTestId("remote-input-key-cursor-left-right");
      expect(cursorLeftRight).toHaveAttribute("aria-label", "Cursor right (hold Shift for left)");
      expect(cursorLeftRight.textContent ?? "").not.toMatch(/CUR/i);
      expect(cursorLeftRight.textContent).toContain("→");
      expect(cursorLeftRight.textContent).toContain("←");
    });
  });

  describe("secondary legends", () => {
    it("shows authentic C64 shifted symbols as secondary keycap legends", () => {
      renderKeyboard("medium");
      const legend: Array<[string, string]> = [
        ["remote-input-key-1", "!"],
        ["remote-input-key-2", '"'],
        ["remote-input-key-3", "#"],
        ["remote-input-key-4", "$"],
        ["remote-input-key-5", "%"],
        ["remote-input-key-6", "&"],
        ["remote-input-key-7", "'"],
        ["remote-input-key-8", "("],
        ["remote-input-key-9", ")"],
        ["remote-input-key-colon", "["],
        ["remote-input-key-semicolon", "]"],
        ["remote-input-key-comma", "<"],
        ["remote-input-key-period", ">"],
        ["remote-input-key-slash", "?"],
      ];
      for (const [testId, symbol] of legend) {
        expect(screen.getByTestId(testId).textContent).toContain(symbol);
      }
    });
  });

  describe("accessibility", () => {
    it.each(PROFILES)("gives every rendered key an accessible name in the %s profile", (profile) => {
      renderKeyboard(profile);
      const keyboard = screen.getByTestId("remote-input-type-keyboard");
      for (const button of within(keyboard).getAllByRole("button")) {
        const accessibleName = button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "";
        expect(accessibleName.length, button.getAttribute("data-testid") ?? "unknown").toBeGreaterThan(0);
      }
    });

    it("spells RESTORE in full on every profile (expanded is double-width now, so no abbreviation is needed)", () => {
      renderKeyboard("compact");
      const restoreCompact = screen.getByTestId("remote-input-key-restore");
      expect(restoreCompact.textContent).toContain("RESTORE");
      expect(restoreCompact).toHaveAttribute("aria-label", "Restore");
      cleanup();
      renderKeyboard("expanded");
      const restoreExpanded = screen.getByTestId("remote-input-key-restore");
      expect(restoreExpanded.textContent).toContain("RESTORE");
      expect(restoreExpanded).toHaveAttribute("aria-label", "Restore");
    });

    it("keeps full accessible labels for the C= modifier regardless of profile", () => {
      renderKeyboard("compact");
      const commodore = screen.getByTestId("remote-input-key-commodore");
      expect(commodore.textContent).toContain("C=");
      expect(commodore).toHaveAttribute("aria-label", "Commodore key");
    });
  });

  describe("tier gating", () => {
    it("disables the no-fallback keys on the kernal-fallback tier with a non-technical explanation", () => {
      renderKeyboard("medium", "kernal-fallback");
      // RUN/STOP, RESTORE, C=, CTRL have no kernal-buffer equivalent — shown but disabled.
      for (const id of ["run-stop", "restore", "commodore", "ctrl"]) {
        expect(screen.getByTestId(`remote-input-key-${id}`)).toBeDisabled();
      }
      // Keys that DO work over the fallback stay enabled.
      for (const id of ["clr", "home", "ins", "del", "f1", "f8", "shift", "shift-lock"]) {
        expect(screen.getByTestId(`remote-input-key-${id}`)).not.toBeDisabled();
      }
      // The explanation is present but free of REST/firmware jargon.
      const hint = screen.getByTestId("remote-input-modifier-unavailable-hint");
      expect(hint.textContent).not.toMatch(/machine:input|firmware/i);
    });

    // Lead F3: the fallback injection needs the same authenticated REST calls
    // the capability probe already failed with 403 on, so every ordinary key
    // would silently fail - show why instead of a live-looking keyboard.
    it("shows a password-required hint instead of the interactive keyboard on the auth-required tier", () => {
      renderKeyboard("medium", "auth-required");

      expect(screen.getByTestId("remote-input-auth-required-hint")).toHaveTextContent(/password/i);
      expect(screen.queryByTestId("remote-input-key-a")).not.toBeInTheDocument();
      expect(screen.queryByTestId("remote-input-keyboard-deck")).not.toBeInTheDocument();
    });
  });
});
