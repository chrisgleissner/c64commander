/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRemoteInputKeypadTyping } from "@/hooks/useRemoteInputKeypadTyping";

const keyEvent = (key: string, code = key, repeat = false) => {
  const preventDefault = vi.fn();
  const event = { key, code, repeat, preventDefault } as unknown as ReactKeyboardEvent<HTMLElement>;
  return { event, preventDefault };
};

describe("useRemoteInputKeypadTyping", () => {
  const sendChar = vi.fn();
  const sendCursor = vi.fn();
  const renderTyping = () => renderHook(() => useRemoteInputKeypadTyping({ sendChar, sendCursor }));

  beforeEach(() => {
    vi.useFakeTimers();
    sendChar.mockClear();
    sendCursor.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a letter once the multi-tap window has passed", () => {
    const { result } = renderTyping();

    act(() => result.current.handleKeyDown(keyEvent("2", "Digit2").event));
    expect(sendChar).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1000));

    expect(sendChar.mock.calls).toEqual([["a"]]);
  });

  it("ignores a held digit and a held OK, so one press types one character", () => {
    const { result } = renderTyping();

    act(() => result.current.handleKeyDown(keyEvent("2", "Digit2").event));
    const repeatedDigit = keyEvent("2", "Digit2", true);
    act(() => result.current.handleKeyDown(repeatedDigit.event));
    act(() => result.current.handleKeyDown(keyEvent("Enter").event));
    const repeatedOk = keyEvent("Enter", "Enter", true);
    act(() => result.current.handleKeyDown(repeatedOk.event));

    expect(sendChar.mock.calls).toEqual([["a"], ["\r"]]);
    expect(repeatedDigit.preventDefault).toHaveBeenCalled();
    expect(repeatedOk.preventDefault).toHaveBeenCalled();
  });

  it("commits the letter being chosen before a cursor key, and leaves unrelated keys alone", () => {
    const { result } = renderTyping();

    act(() => result.current.handleKeyDown(keyEvent("3", "Digit3").event));
    act(() => result.current.handleKeyDown(keyEvent("ArrowLeft").event));
    const escape = keyEvent("Escape");
    act(() => result.current.handleKeyDown(escape.event));
    const unbound = keyEvent("Shift", "ShiftLeft");
    act(() => result.current.handleKeyDown(unbound.event));

    expect(sendChar.mock.calls).toEqual([["d"]]);
    expect(sendCursor.mock.calls).toEqual([["left"]]);
    expect(escape.preventDefault).not.toHaveBeenCalled();
    expect(unbound.preventDefault).not.toHaveBeenCalled();
  });

  it("drops a letter still being chosen on reset, and sends nothing when its window passes", () => {
    const { result } = renderTyping();

    act(() => result.current.handleKeyDown(keyEvent("4", "Digit4").event));
    act(() => result.current.reset());
    act(() => void vi.advanceTimersByTime(1000));
    act(() => result.current.handleKeyDown(keyEvent("5", "Digit5").event));
    act(() => result.current.handleKeyDown(keyEvent("Enter").event));

    expect(sendChar.mock.calls).toEqual([["j"], ["\r"]]);
  });

  it("sends nothing after unmounting with a letter still being chosen", () => {
    const { result, unmount } = renderTyping();

    act(() => result.current.handleKeyDown(keyEvent("6", "Digit6").event));
    unmount();
    act(() => void vi.advanceTimersByTime(1000));

    expect(sendChar).not.toHaveBeenCalled();
  });
});
