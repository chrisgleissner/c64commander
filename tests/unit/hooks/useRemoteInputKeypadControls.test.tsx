/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  useRemoteInputKeypadControls,
  type RemoteInputKeypadControlsOptions,
} from "@/hooks/useRemoteInputKeypadControls";

const SKIP = "data-key-nav-skip";

const baseOptions: RemoteInputKeypadControlsOptions = {
  open: true,
  outputMode: "joystick",
  keypadDrivesTheC64: true,
  joystickAvailable: true,
  gameModeAvailable: true,
  immersive: false,
  optionsFolded: false,
  onOutputModeChange: vi.fn(),
  onOpenOptions: vi.fn(),
  onEnterGameMode: vi.fn(),
  onExitGameMode: vi.fn(),
  onReleaseAll: vi.fn(),
  onClose: vi.fn(),
};

const softRight = () =>
  ({ key: "SoftRight", code: "SoftRight", preventDefault: vi.fn() }) as unknown as ReactKeyboardEvent<HTMLElement>;

const choose = (items: readonly { id: string; onSelect: () => void }[], id: string) =>
  act(() => items.find((item) => item.id === id)?.onSelect());

describe("useRemoteInputKeypadControls", () => {
  it("starts driving again with the menu shut when the sheet closes while the keypad operated it", () => {
    const { result, rerender } = renderHook(
      (options: RemoteInputKeypadControlsOptions) => useRemoteInputKeypadControls(options),
      { initialProps: baseOptions },
    );
    act(() => void result.current.interceptKeyDown(softRight()));
    choose(result.current.menu.items, "controls");
    expect(result.current.sheetProps).not.toHaveProperty(SKIP);

    rerender({ ...baseOptions, open: false });

    expect(result.current.sheetProps).toHaveProperty(SKIP);
    expect(result.current.menu.open).toBe(false);
  });

  it("leaves Back to close the sheet while driving", () => {
    const { result } = renderHook(() => useRemoteInputKeypadControls(baseOptions));
    const escape = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });

    result.current.sheetProps.onEscapeKeyDown(escape);

    expect(escape.defaultPrevented).toBe(false);
  });

  it("moves to the sheet's first control when it has no close button, as in Game Mode", () => {
    const sheet = document.createElement("div");
    sheet.setAttribute("data-testid", "remote-input-sheet");
    const handle = document.createElement("button");
    sheet.append(handle);
    document.body.append(sheet);
    try {
      const { result } = renderHook(() => useRemoteInputKeypadControls(baseOptions));
      choose(result.current.menu.items, "controls");

      act(() => result.current.menu.onClosed());

      expect(document.activeElement).toBe(handle);
    } finally {
      sheet.remove();
    }
  });

  it("restores no focus when the menu closes after the sheet has gone", () => {
    const { result } = renderHook(() => useRemoteInputKeypadControls(baseOptions));
    const before = document.activeElement;

    act(() => result.current.menu.onClosed());

    expect(document.activeElement).toBe(before);
  });
});
