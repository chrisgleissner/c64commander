/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuickKeysBar } from "@/components/remoteInput/QuickKeysBar";

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
    render(<QuickKeysBar {...makeHandlers()} tier="full" />);
    for (const id of [...FALLBACK_OK_TEST_IDS, ...FULL_ONLY_TEST_IDS]) {
      expect(screen.getByTestId(id), id).not.toBeDisabled();
    }
  });

  it("exposes all eight function keys, printed lower-case with a space (f 1 … f 8)", () => {
    render(<QuickKeysBar {...makeHandlers()} tier="full" />);
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(screen.getByTestId(`remote-input-key-f${n}`)).toHaveTextContent(`f ${n}`);
    }
  });

  it("lays the deck out in the requested five rows (RUN/STOP·CTRL·SPACE·RETURN / f-keys / cursors / C=·SHIFT·SPACE·SHIFT)", () => {
    render(<QuickKeysBar {...makeHandlers()} tier="full" />);
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
    render(<QuickKeysBar {...makeHandlers()} tier="kernal-fallback" />);
    for (const id of FALLBACK_OK_TEST_IDS) expect(screen.getByTestId(id), id).not.toBeDisabled();
    for (const id of FULL_ONLY_TEST_IDS) expect(screen.getByTestId(id), id).toBeDisabled();
  });

  it("disables every key on the auth-required tier; injectable keys cite the password, modifiers a plain hint", () => {
    render(<QuickKeysBar {...makeHandlers()} tier="auth-required" />);
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

  it("routes SPACE/RETURN through onChar, cursors through onCursor, f-keys through onSpecialKey", () => {
    const handlers = makeHandlers();
    render(<QuickKeysBar {...handlers} tier="full" />);
    fireEvent.click(screen.getByTestId("remote-input-key-space"));
    fireEvent.click(screen.getByTestId("remote-input-key-space-bottom"));
    expect(handlers.onChar).toHaveBeenNthCalledWith(1, " ");
    expect(handlers.onChar).toHaveBeenNthCalledWith(2, " ");
    fireEvent.click(screen.getByTestId("remote-input-key-return"));
    expect(handlers.onChar).toHaveBeenLastCalledWith("\n");
    fireEvent.click(screen.getByTestId("remote-input-key-cursor-left"));
    expect(handlers.onCursor).toHaveBeenCalledWith("left");
    fireEvent.click(screen.getByTestId("remote-input-key-f3"));
    expect(handlers.onSpecialKey).toHaveBeenCalledWith("f3");
  });

  it("routes the CTRL / C= / SHIFT modifiers through onKey with the matching chord input", () => {
    const handlers = makeHandlers();
    render(<QuickKeysBar {...handlers} tier="full" />);
    fireEvent.click(screen.getByTestId("remote-input-key-ctrl"));
    expect(handlers.onKey).toHaveBeenCalledWith(["ctrl"]);
    fireEvent.click(screen.getByTestId("remote-input-key-commodore"));
    expect(handlers.onKey).toHaveBeenCalledWith(["commodore"]);
    fireEvent.click(screen.getByTestId("remote-input-key-shift-left"));
    expect(handlers.onKey).toHaveBeenCalledWith(["left_shift"]);
    fireEvent.click(screen.getByTestId("remote-input-key-shift-right"));
    expect(handlers.onKey).toHaveBeenCalledWith(["right_shift"]);
    expect(handlers.onKey).toHaveBeenCalledTimes(4);
  });

  it("does not fire any handler when a disabled key is clicked (auth-required)", () => {
    const handlers = makeHandlers();
    render(<QuickKeysBar {...handlers} tier="auth-required" />);
    fireEvent.click(screen.getByTestId("remote-input-key-space"));
    fireEvent.click(screen.getByTestId("remote-input-key-ctrl"));
    expect(handlers.onChar).not.toHaveBeenCalled();
    expect(handlers.onKey).not.toHaveBeenCalled();
  });

  it("tints the odd function keys f1/f3/f5/f7 but not the even ones (matches the Keys tab)", () => {
    render(<QuickKeysBar {...makeHandlers()} tier="full" />);
    for (const n of [1, 3, 5, 7]) {
      expect(screen.getByTestId(`remote-input-key-f${n}`).className, `f${n}`).toMatch(/slate/);
    }
    for (const n of [2, 4, 6, 8]) {
      expect(screen.getByTestId(`remote-input-key-f${n}`).className, `f${n}`).not.toMatch(/slate/);
    }
  });

  it("carries the shared caution affordance on RUN/STOP and keeps it clear of RETURN (HARD16-006)", () => {
    render(<QuickKeysBar {...makeHandlers()} tier="full" />);
    const runStop = screen.getByTestId("remote-input-key-run-stop");
    // Caution affordance: shape (dashed border) + colour, matching the Keys tab.
    expect(runStop.className).toContain("border-dashed");
    expect(runStop.className).toContain("border-amber-500");
    // RUN/STOP and RETURN share the top row but are never adjacent — CTRL and
    // SPACE sit between them, so a wide RETURN tap can never halt the program.
    const returnKey = screen.getByTestId("remote-input-key-return");
    expect(runStop.compareDocumentPosition(returnKey) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(runStop.nextElementSibling).not.toBe(returnKey);
  });

  it("colours both SHIFT keys with the shared violet shift treatment", () => {
    render(<QuickKeysBar {...makeHandlers()} tier="full" />);
    for (const id of ["remote-input-key-shift-left", "remote-input-key-shift-right"]) {
      expect(screen.getByTestId(id).className, id).toMatch(/violet/);
    }
  });
});
