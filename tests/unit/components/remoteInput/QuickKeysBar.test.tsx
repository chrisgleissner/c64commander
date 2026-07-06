/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuickKeysBar, type QuickKeysBarProps } from "@/components/remoteInput/QuickKeysBar";
import { EMPTY_HELD_KEYBOARD_INPUTS } from "@/lib/remoteInput/keyboardHeldSet";
import type { HeldKeyboardInputs } from "@/lib/remoteInput/keyboardHeldSet";

/** Wires a real held-keyboard-inputs state, mirroring what useRemoteInputSession provides. */
const QuickKeysBarHarness = (
  props: Omit<QuickKeysBarProps, "heldKeyboardInputs" | "onHeldKeyboardInputsChange"> & {
    onHeldChange?: (next: HeldKeyboardInputs) => void;
  },
) => {
  const { onHeldChange, ...rest } = props;
  const [held, setHeld] = useState<HeldKeyboardInputs>(EMPTY_HELD_KEYBOARD_INPUTS);
  return (
    <QuickKeysBar
      {...rest}
      heldKeyboardInputs={held}
      onHeldKeyboardInputsChange={(next) => {
        onHeldChange?.(next);
        setHeld(next);
      }}
    />
  );
};

// The keys that ALSO work over the kernal-fallback injection (so they only go
// dark on auth-required): SPACE/RETURN, both function-key rows, the cursors,
// and the second (bottom) SPACE.
const FALLBACK_OK_TEST_IDS = [
  "remote-input-key-space",
  "remote-input-key-return",
  "remote-input-key-f1",
  "remote-input-key-f2",
  "remote-input-key-f3",
  "remote-input-key-f4",
  "remote-input-key-f5",
  "remote-input-key-f6",
  "remote-input-key-f7",
  "remote-input-key-f8",
  "remote-input-key-cursor-up",
  "remote-input-key-cursor-down",
  "remote-input-key-cursor-left",
  "remote-input-key-cursor-right",
  "remote-input-key-space-bottom",
];

// The keys with no kernal-buffer equivalent (need the full machine:input tier):
// RUN/STOP and the CTRL / C= / SHIFT modifiers.
const FULL_ONLY_TEST_IDS = [
  "remote-input-key-run-stop",
  "remote-input-key-ctrl",
  "remote-input-key-commodore",
  "remote-input-key-shift-left",
  "remote-input-key-shift-right",
];

const makeHandlers = () => ({
  onChar: vi.fn(),
  onKey: vi.fn(),
  onCursor: vi.fn(),
  onSpecialKey: vi.fn(),
});

describe("QuickKeysBar", () => {
  afterEach(() => cleanup());

  it("keeps every key enabled on the full tier", () => {
    render(<QuickKeysBarHarness {...makeHandlers()} tier="full" />);
    for (const id of [...FALLBACK_OK_TEST_IDS, ...FULL_ONLY_TEST_IDS]) {
      expect(screen.getByTestId(id), id).not.toBeDisabled();
    }
  });

  it("exposes all eight function keys, printed lower-case with a space (f 1 … f 8)", () => {
    render(<QuickKeysBarHarness {...makeHandlers()} tier="full" />);
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(screen.getByTestId(`remote-input-key-f${n}`)).toHaveTextContent(`f ${n}`);
    }
  });

  it("lays the deck out in the requested five rows (RUN/STOP·CTRL·SPACE·RETURN / f-keys / cursors / C=·SHIFT·SPACE·SHIFT)", () => {
    render(<QuickKeysBarHarness {...makeHandlers()} tier="full" />);
    const bar = screen.getByTestId("remote-input-quick-keys-bar");
    const rows = Array.from(bar.children);
    const idsIn = (row: Element) =>
      Array.from(row.querySelectorAll("[data-testid^='remote-input-key-']")).map((el) =>
        el.getAttribute("data-testid"),
      );
    expect(rows).toHaveLength(5);
    expect(idsIn(rows[0])).toEqual([
      "remote-input-key-run-stop",
      "remote-input-key-ctrl",
      "remote-input-key-space",
      "remote-input-key-return",
    ]);
    expect(idsIn(rows[1])).toEqual([
      "remote-input-key-f1",
      "remote-input-key-f2",
      "remote-input-key-f3",
      "remote-input-key-f4",
    ]);
    expect(idsIn(rows[2])).toEqual([
      "remote-input-key-f5",
      "remote-input-key-f6",
      "remote-input-key-f7",
      "remote-input-key-f8",
    ]);
    expect(idsIn(rows[3])).toEqual([
      "remote-input-key-cursor-up",
      "remote-input-key-cursor-down",
      "remote-input-key-cursor-left",
      "remote-input-key-cursor-right",
    ]);
    expect(idsIn(rows[4])).toEqual([
      "remote-input-key-commodore",
      "remote-input-key-shift-left",
      "remote-input-key-space-bottom",
      "remote-input-key-shift-right",
    ]);
  });

  it("keeps the fallback-injectable keys live on kernal-fallback but disables the no-fallback keys", () => {
    render(<QuickKeysBarHarness {...makeHandlers()} tier="kernal-fallback" />);
    for (const id of FALLBACK_OK_TEST_IDS) expect(screen.getByTestId(id), id).not.toBeDisabled();
    for (const id of FULL_ONLY_TEST_IDS) expect(screen.getByTestId(id), id).toBeDisabled();
  });

  it("disables every key on the auth-required tier; injectable keys cite the password, modifiers a plain hint", () => {
    render(<QuickKeysBarHarness {...makeHandlers()} tier="auth-required" />);
    for (const id of FALLBACK_OK_TEST_IDS) {
      const button = screen.getByTestId(id);
      expect(button, id).toBeDisabled();
      expect(button, id).toHaveAttribute("title", expect.stringMatching(/password/i));
    }
    for (const id of FULL_ONLY_TEST_IDS) {
      const button = screen.getByTestId(id);
      expect(button, id).toBeDisabled();
      // No REST/firmware jargon on the disabled modifiers.
      expect(button.getAttribute("title") ?? "", id).not.toMatch(/machine:input|firmware|REST/i);
    }
  });

  it("routes cursors through onCursor regardless of tier (no hold relay for cursor keys)", () => {
    const handlers = makeHandlers();
    render(<QuickKeysBarHarness {...handlers} tier="full" />);
    fireEvent.click(screen.getByTestId("remote-input-key-cursor-left"));
    expect(handlers.onCursor).toHaveBeenCalledWith("left");
  });

  it("routes SPACE/RETURN/f-keys through the held-keyboard-inputs set on the full tier, not onChar/onSpecialKey", () => {
    const handlers = makeHandlers();
    const snapshots: string[][] = [];
    render(
      <QuickKeysBarHarness {...handlers} tier="full" onHeldChange={(next) => snapshots.push([...next].sort())} />,
    );
    fireEvent.click(screen.getByTestId("remote-input-key-space"));
    fireEvent.click(screen.getByTestId("remote-input-key-return"));
    fireEvent.click(screen.getByTestId("remote-input-key-f3"));
    expect(handlers.onChar).not.toHaveBeenCalled();
    expect(handlers.onSpecialKey).not.toHaveBeenCalled();
    // Each tap presses then releases its own input via the held set.
    expect(snapshots).toContainEqual(["space"]);
    expect(snapshots).toContainEqual(["return"]);
    expect(snapshots).toContainEqual(["f3"]);
  });

  it("holds SPACE/RETURN/f-keys via a real pointer down/up on the full tier, not just a tap-and-release", () => {
    const handlers = makeHandlers();
    const snapshots: string[][] = [];
    render(
      <QuickKeysBarHarness {...handlers} tier="full" onHeldChange={(next) => snapshots.push([...next].sort())} />,
    );
    const returnKey = screen.getByTestId("remote-input-key-return");

    fireEvent.pointerDown(returnKey, { pointerId: 1 });
    // Still held after press: onHeldChange must reflect it going down, not
    // waiting for a release that hasn't happened yet.
    expect(snapshots).toContainEqual(["return"]);
    expect(handlers.onChar).not.toHaveBeenCalled();

    fireEvent.pointerUp(returnKey, { pointerId: 1 });
    expect(snapshots.at(-1)).toEqual([]);
  });

  it("falls back to onChar/onSpecialKey on the kernal-fallback tier (no held-set relay exists below full)", () => {
    const handlers = makeHandlers();
    render(<QuickKeysBarHarness {...handlers} tier="kernal-fallback" />);
    fireEvent.click(screen.getByTestId("remote-input-key-space"));
    fireEvent.click(screen.getByTestId("remote-input-key-space-bottom"));
    expect(handlers.onChar).toHaveBeenNthCalledWith(1, " ");
    expect(handlers.onChar).toHaveBeenNthCalledWith(2, " ");
    fireEvent.click(screen.getByTestId("remote-input-key-return"));
    expect(handlers.onChar).toHaveBeenLastCalledWith("\n");
    fireEvent.click(screen.getByTestId("remote-input-key-f3"));
    expect(handlers.onSpecialKey).toHaveBeenCalledWith("f3");
  });

  it("does NOT latch CTRL / C= / SHIFT on a bare tap — a tap presses then releases (regression)", () => {
    // Regression: a bare modifier tap used to LATCH the key onto the held set
    // (staying asserted for the next key), which left C=/SHIFT stuck on the
    // device and made games unplayable. A tap must now be a genuine
    // press-then-release, leaving nothing asserted.
    const handlers = makeHandlers();
    const snapshots: string[][] = [];
    render(
      <QuickKeysBarHarness {...handlers} tier="full" onHeldChange={(next) => snapshots.push([...next].sort())} />,
    );

    for (const testId of [
      "remote-input-key-ctrl",
      "remote-input-key-commodore",
      "remote-input-key-shift-left",
      "remote-input-key-shift-right",
    ]) {
      snapshots.length = 0;
      fireEvent.click(screen.getByTestId(testId));
      // The tap both pressed and released the modifier: the held set ends empty
      // and the key is not left visually latched.
      expect(snapshots.at(-1), testId).toEqual([]);
      expect(screen.getByTestId(testId), testId).toHaveAttribute("aria-pressed", "false");
    }

    // Full tier relays via the held-set, never the tap-event onKey prop.
    expect(handlers.onKey).not.toHaveBeenCalled();
  });

  it("keeps a modifier asserted for exactly as long as it is physically held (CTRL flipper-style hold)", () => {
    const handlers = makeHandlers();
    const snapshots: string[][] = [];
    render(
      <QuickKeysBarHarness {...handlers} tier="full" onHeldChange={(next) => snapshots.push([...next].sort())} />,
    );
    const ctrl = screen.getByTestId("remote-input-key-ctrl");

    fireEvent.pointerDown(ctrl, { pointerId: 1 });
    expect(snapshots).toContainEqual(["ctrl"]);
    expect(ctrl).toHaveAttribute("aria-pressed", "true");

    fireEvent.pointerUp(ctrl, { pointerId: 1 });
    expect(snapshots.at(-1)).toEqual([]);
    expect(ctrl).toHaveAttribute("aria-pressed", "false");
    expect(handlers.onKey).not.toHaveBeenCalled();
  });

  it("does not fire any handler when a disabled key is clicked (auth-required)", () => {
    const handlers = makeHandlers();
    render(<QuickKeysBarHarness {...handlers} tier="auth-required" />);
    fireEvent.click(screen.getByTestId("remote-input-key-space"));
    fireEvent.click(screen.getByTestId("remote-input-key-ctrl"));
    expect(handlers.onChar).not.toHaveBeenCalled();
    expect(handlers.onKey).not.toHaveBeenCalled();
  });

  it("tints the odd function keys f1/f3/f5/f7 but not the even ones (matches the Keys tab)", () => {
    render(<QuickKeysBarHarness {...makeHandlers()} tier="full" />);
    for (const n of [1, 3, 5, 7]) {
      expect(screen.getByTestId(`remote-input-key-f${n}`).className, `f${n}`).toMatch(/slate/);
    }
    for (const n of [2, 4, 6, 8]) {
      expect(screen.getByTestId(`remote-input-key-f${n}`).className, `f${n}`).not.toMatch(/slate/);
    }
  });

  it("carries the shared caution affordance on RUN/STOP and keeps it clear of RETURN (HARD16-006)", () => {
    render(<QuickKeysBarHarness {...makeHandlers()} tier="full" />);
    const runStop = screen.getByTestId("remote-input-key-run-stop");
    // Caution affordance: shape (solid double border) + colour, matching the Keys tab.
    expect(runStop.className).toContain("border-2");
    expect(runStop.className).toContain("border-warning");
    // RUN/STOP and RETURN share the top row but are never adjacent — CTRL and
    // SPACE sit between them, so a wide RETURN tap can never halt the program.
    const returnKey = screen.getByTestId("remote-input-key-return");
    expect(runStop.compareDocumentPosition(returnKey) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(runStop.nextElementSibling).not.toBe(returnKey);
  });

  it("colours both SHIFT keys with the shared primary shift treatment", () => {
    render(<QuickKeysBarHarness {...makeHandlers()} tier="full" />);
    for (const id of ["remote-input-key-shift-left", "remote-input-key-shift-right"]) {
      expect(screen.getByTestId(id).className, id).toMatch(/border-primary/);
    }
  });
});
