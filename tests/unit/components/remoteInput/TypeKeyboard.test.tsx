/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TypeKeyboard, type TypeKeyboardProps, type TypeKeyboardTier } from "@/components/remoteInput/TypeKeyboard";
import type { KeyboardProfile } from "@/lib/remoteInput/keyboardProfile";

const PROFILES: KeyboardProfile[] = ["compact", "medium", "expanded"];

const makeHandlers = () => ({
  onChar: vi.fn(),
  onKey: vi.fn(),
  onCursor: vi.fn(),
  onSpecialKey: vi.fn(),
});

const renderKeyboard = (profile: KeyboardProfile, tier: TypeKeyboardTier = "full") => {
  const handlers: Pick<TypeKeyboardProps, "onChar" | "onKey" | "onCursor" | "onSpecialKey"> = makeHandlers();
  render(<TypeKeyboard {...handlers} tier={tier} profile={profile} />);
  return handlers as ReturnType<typeof makeHandlers>;
};

// Every direct high-value virtual key that must exist in EVERY Type profile.
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
      for (const f of ["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8"]) {
        expect(within(box).getByTestId(`remote-input-key-${f}`)).toBeInTheDocument();
      }
    });

    it("defaults to medium when the content box has not been measured (no override)", () => {
      const handlers = makeHandlers();
      render(<TypeKeyboard {...handlers} tier="full" />);
      expect(screen.getByTestId("remote-input-type-keyboard")).toHaveAttribute("data-profile", "medium");
    });

    it("splits the function keys into two rows on compact but one row on medium", () => {
      renderKeyboard("compact");
      expect(screen.getByTestId("remote-input-keyboard-function").children.length).toBe(2);
      expect(
        within(screen.getByTestId("remote-input-keyboard-function")).getByTestId("remote-input-key-f8"),
      ).toBeInTheDocument();
      cleanup();
      renderKeyboard("medium");
      expect(screen.getByTestId("remote-input-keyboard-function").children.length).toBe(1);
    });

    it("renders a second full-width SPACE at the bottom of the deck (SPACE appears twice)", () => {
      renderKeyboard("compact");
      const bottom = screen.getByTestId("remote-input-keyboard-bottom-space");
      expect(within(bottom).getByTestId("remote-input-key-space-bottom")).toBeInTheDocument();
      // The top immediate SPACE is still present too.
      expect(screen.getByTestId("remote-input-key-space")).toBeInTheDocument();
    });
  });

  describe("high-value key visibility", () => {
    it.each(PROFILES)("exposes every high-value direct virtual key in the %s profile", (profile) => {
      renderKeyboard(profile);
      for (const testId of HIGH_VALUE_TEST_IDS) {
        expect(screen.getByTestId(testId), `${profile} missing ${testId}`).toBeInTheDocument();
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
    it("dispatches CLR/INS and F2/F4/F6/F8 through the shared special-key handler", () => {
      const h = renderKeyboard("expanded");
      const cases: Array<[string, string]> = [
        ["remote-input-key-clr", "clr"],
        ["remote-input-key-ins", "ins"],
        ["remote-input-key-f2", "f2"],
        ["remote-input-key-f4", "f4"],
        ["remote-input-key-f6", "f6"],
        ["remote-input-key-f8", "f8"],
      ];
      for (const [testId, key] of cases) {
        fireEvent.click(screen.getByTestId(testId));
        expect(h.onSpecialKey).toHaveBeenCalledWith(key);
      }
    });

    it("dispatches CURSOR_UP and CURSOR_LEFT as keyboard cursor movement", () => {
      const h = renderKeyboard("medium");
      fireEvent.click(screen.getByTestId("remote-input-key-cursor-up"));
      expect(h.onCursor).toHaveBeenCalledWith("up");
      fireEvent.click(screen.getByTestId("remote-input-key-cursor-left"));
      expect(h.onCursor).toHaveBeenCalledWith("left");
    });

    it("latches SHIFT onto the next ordinary key, then auto-clears it", () => {
      const h = renderKeyboard("medium");
      fireEvent.click(screen.getByTestId("remote-input-key-shift"));
      expect(screen.getByTestId("remote-input-key-shift")).toHaveAttribute("aria-pressed", "true");

      fireEvent.click(screen.getByTestId("remote-input-key-a"));
      expect(h.onKey).toHaveBeenLastCalledWith(["a", "left_shift"]);
      expect(screen.getByTestId("remote-input-key-shift")).toHaveAttribute("aria-pressed", "false");

      fireEvent.click(screen.getByTestId("remote-input-key-a"));
      expect(h.onKey).toHaveBeenLastCalledWith(["a"]);
    });

    it("never leaves SHIFT stuck after an atomic action (no modifier leak)", () => {
      const h = renderKeyboard("expanded");
      fireEvent.click(screen.getByTestId("remote-input-key-shift"));
      expect(screen.getByTestId("remote-input-key-shift")).toHaveAttribute("aria-pressed", "true");

      // The atomic CLR ships its own Shift chord via the mapping; the UI latch
      // must not linger afterwards, and CLR must not go through the char path.
      fireEvent.click(screen.getByTestId("remote-input-key-clr"));
      expect(h.onSpecialKey).toHaveBeenCalledWith("clr");
      expect(h.onKey).not.toHaveBeenCalled();
      expect(screen.getByTestId("remote-input-key-shift")).toHaveAttribute("aria-pressed", "false");
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
    it("keeps the C64 arrow-left character key distinct from CURSOR_LEFT", () => {
      const h = renderKeyboard("expanded");
      fireEvent.click(screen.getByTestId("remote-input-key-arrow_left"));
      expect(h.onKey).toHaveBeenCalledWith(["arrow_left"]);
      expect(h.onCursor).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId("remote-input-key-cursor-left"));
      expect(h.onCursor).toHaveBeenCalledWith("left");

      const arrowLeft = screen.getByTestId("remote-input-key-arrow_left");
      expect(arrowLeft).toHaveAttribute("aria-label", "C64 left-arrow character key");
      // Visible label is the authentic printed glyph, never "ARW".
      expect(arrowLeft.textContent).toBe("←");
      expect(arrowLeft.textContent).not.toMatch(/ARW/i);
      // The cursor key is an icon (no "CUR" text) and stays distinct.
      const cursorLeft = screen.getByTestId("remote-input-key-cursor-left");
      expect(cursorLeft).toHaveAttribute("aria-label", "Cursor left");
      expect(cursorLeft.textContent ?? "").not.toMatch(/CUR/i);
      expect(cursorLeft.querySelector("svg")).toBeTruthy();
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

    it("keeps the abbreviated RESTORE / C= visual labels but full accessible labels", () => {
      renderKeyboard("compact");
      const restore = screen.getByTestId("remote-input-key-restore");
      expect(restore.textContent).toContain("REST");
      expect(restore).toHaveAttribute("aria-label", "Restore");
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
