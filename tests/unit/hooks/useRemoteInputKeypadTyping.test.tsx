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

import { C64_MULTITAP_CANDIDATES, useRemoteInputKeypadTyping } from "@/hooks/useRemoteInputKeypadTyping";
import { MULTITAP_CANDIDATES } from "@/lib/input/t9";
import { charToKeyboardInputEvents } from "@/lib/remoteInput/keyboardCharMapping";

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

  it("offers only characters the C64 has a key for, and every other one the app's fields offer", () => {
    const offered = Object.values(C64_MULTITAP_CANDIDATES).flat();
    const unmapped = Object.values(MULTITAP_CANDIDATES)
      .flat()
      .filter((char) => !offered.includes(char));

    expect(offered.filter((char) => charToKeyboardInputEvents(char).length === 0)).toEqual([]);
    expect(unmapped).toEqual(["_"]);
  });

  it("deletes a letter still being chosen without sending it, then sends DEL, once per press", () => {
    const { result } = renderTyping();

    act(() => result.current.handleKeyDown(keyEvent("7", "Digit7").event));
    const deleteKey = keyEvent("SoftRight");
    act(() => result.current.handleKeyDown(deleteKey.event));
    act(() => void vi.advanceTimersByTime(1000));
    act(() => result.current.handleKeyDown(keyEvent("SoftRight").event));
    act(() => result.current.handleKeyDown(keyEvent("SoftRight", "SoftRight", true).event));

    expect(sendChar.mock.calls).toEqual([["\b"]]);
    expect(deleteKey.preventDefault).toHaveBeenCalled();
  });

  it("sends a chosen letter before the DEL that follows it", () => {
    const { result } = renderTyping();

    act(() => result.current.handleKeyDown(keyEvent("8", "Digit8").event));
    act(() => result.current.handleKeyDown(keyEvent("9", "Digit9").event));
    act(() => result.current.handleKeyDown(keyEvent("SoftRight").event));

    expect(sendChar.mock.calls).toEqual([["t"]]);
    act(() => void vi.advanceTimersByTime(1000));
    act(() => result.current.handleKeyDown(keyEvent("SoftRight").event));
    expect(sendChar.mock.calls).toEqual([["t"], ["\b"]]);
  });
});
