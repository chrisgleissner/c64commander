/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuickKeysBar } from "@/components/remoteInput/QuickKeysBar";

const KEY_TEST_IDS = [
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
];

const makeHandlers = () => ({ onChar: vi.fn(), onCursor: vi.fn(), onSpecialKey: vi.fn() });

describe("QuickKeysBar", () => {
  it("keeps every key enabled on the full tier", () => {
    render(<QuickKeysBar {...makeHandlers()} tier="full" />);
    for (const id of KEY_TEST_IDS) expect(screen.getByTestId(id)).not.toBeDisabled();
    expect(screen.getByTestId("remote-input-key-run-stop")).not.toBeDisabled();
  });

  it("exposes all eight function keys F1-F8 (not just the odd ones)", () => {
    render(<QuickKeysBar {...makeHandlers()} tier="full" />);
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(screen.getByTestId(`remote-input-key-f${n}`)).toBeInTheDocument();
    }
  });

  it("keeps every key except RUN/STOP enabled on the kernal-fallback tier (they work via the fallback injection)", () => {
    render(<QuickKeysBar {...makeHandlers()} tier="kernal-fallback" />);
    for (const id of KEY_TEST_IDS) expect(screen.getByTestId(id)).not.toBeDisabled();
    expect(screen.getByTestId("remote-input-key-run-stop")).toBeDisabled();
  });

  // Lead F3: every one of these keys routes through the fallback injection,
  // which needs the same authenticated REST calls the capability probe
  // already failed with 403 on - unlike kernal-fallback, none of them can
  // succeed here, so all must be disabled (not just RUN/STOP).
  it("disables every key on the auth-required tier, with a password-related hint", () => {
    render(<QuickKeysBar {...makeHandlers()} tier="auth-required" />);
    for (const id of KEY_TEST_IDS) {
      const button = screen.getByTestId(id);
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", expect.stringMatching(/password/i));
    }
    expect(screen.getByTestId("remote-input-key-run-stop")).toBeDisabled();
  });

  it("does not call onChar when a disabled key is clicked on the auth-required tier", () => {
    const handlers = makeHandlers();
    render(<QuickKeysBar {...handlers} tier="auth-required" />);
    fireEvent.click(screen.getByTestId("remote-input-key-space"));
    expect(handlers.onChar).not.toHaveBeenCalled();
  });

  it("renders RUN/STOP last with the shared caution affordance, clear of RETURN (HARD16-006)", () => {
    render(<QuickKeysBar {...makeHandlers()} tier="full" />);
    const runStop = screen.getByTestId("remote-input-key-run-stop");

    // Caution affordance: shape (dashed border) + colour, matching the Keys tab.
    expect(runStop.className).toContain("border-dashed");
    expect(runStop.className).toContain("border-amber-500");

    // Last position: RUN/STOP follows the whole F-key / cursor cluster in DOM order,
    // so a wide RETURN tap can never land on it.
    const bar = screen.getByTestId("remote-input-quick-keys-bar");
    const keyButtons = Array.from(bar.querySelectorAll("[data-testid^='remote-input-key-']"));
    expect(keyButtons[keyButtons.length - 1]).toBe(runStop);

    const cursorRight = screen.getByTestId("remote-input-key-cursor-right");
    expect(runStop.compareDocumentPosition(cursorRight) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });
});
