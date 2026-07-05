/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CursorPad } from "@/components/remoteInput/CursorPad";

const onCursorMock = vi.fn();
const vibrateTapMock = vi.fn();

vi.mock("@/lib/remoteInput/haptics", () => ({
  vibrateTap: (...args: unknown[]) => vibrateTapMock(...args),
}));

describe("CursorPad", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    onCursorMock.mockClear();
    vibrateTapMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits one keyboard cursor movement per keypad/focus-ring click, in each of the four directions", () => {
    render(<CursorPad onCursor={onCursorMock} sizePx={144} />);

    // A focus-ring / keypad activation dispatches a synthetic click (no pointerdown).
    fireEvent.click(screen.getByTestId("remote-input-key-cursor-up"));
    expect(onCursorMock).toHaveBeenLastCalledWith("up");
    fireEvent.click(screen.getByTestId("remote-input-key-cursor-down"));
    expect(onCursorMock).toHaveBeenLastCalledWith("down");
    fireEvent.click(screen.getByTestId("remote-input-key-cursor-left"));
    expect(onCursorMock).toHaveBeenLastCalledWith("left");
    fireEvent.click(screen.getByTestId("remote-input-key-cursor-right"));
    expect(onCursorMock).toHaveBeenLastCalledWith("right");

    expect(onCursorMock).toHaveBeenCalledTimes(4);
  });

  it("auto-repeats a cursor key while held, then stops the instant it is released", () => {
    render(<CursorPad onCursor={onCursorMock} sizePx={144} />);
    const upKey = screen.getByTestId("remote-input-key-cursor-up");

    fireEvent.pointerDown(upKey, { pointerId: 1 });
    expect(onCursorMock).toHaveBeenCalledTimes(1); // fires once immediately on press
    expect(onCursorMock).toHaveBeenLastCalledWith("up");

    act(() => {
      vi.advanceTimersByTime(400 + 100 * 3); // initial delay + three repeat ticks
    });
    expect(onCursorMock.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(onCursorMock.mock.calls.every((call) => call[0] === "up")).toBe(true);

    const countAtRelease = onCursorMock.mock.calls.length;
    fireEvent.pointerUp(upKey, { pointerId: 1 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onCursorMock.mock.calls.length).toBe(countAtRelease); // no repeats after release
  });

  it("stops repeating on pointer cancel", () => {
    render(<CursorPad onCursor={onCursorMock} sizePx={144} />);
    const downKey = screen.getByTestId("remote-input-key-cursor-down");

    fireEvent.pointerDown(downKey, { pointerId: 1 });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    const countAtCancel = onCursorMock.mock.calls.length;
    fireEvent.pointerCancel(downKey, { pointerId: 1 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onCursorMock.mock.calls.length).toBe(countAtCancel);
  });

  it("fires exactly once on a touch tap (pointerdown/up plus the browser's trailing click)", () => {
    render(<CursorPad onCursor={onCursorMock} sizePx={144} />);
    const upKey = screen.getByTestId("remote-input-key-cursor-up");

    fireEvent.pointerDown(upKey, { pointerId: 1 });
    fireEvent.pointerUp(upKey, { pointerId: 1 });
    fireEvent.click(upKey); // real taps dispatch a click after pointerup - it must not double-fire

    expect(onCursorMock).toHaveBeenCalledTimes(1);
    expect(onCursorMock).toHaveBeenCalledWith("up");
  });

  it("vibrates once on the initial press, not on every repeat tick", () => {
    render(<CursorPad onCursor={onCursorMock} sizePx={144} />);
    const upKey = screen.getByTestId("remote-input-key-cursor-up");

    fireEvent.pointerDown(upKey, { pointerId: 1 });
    act(() => {
      vi.advanceTimersByTime(400 + 100 * 5);
    });
    fireEvent.pointerUp(upKey, { pointerId: 1 });

    expect(vibrateTapMock).toHaveBeenCalledTimes(1);
  });

  it("contains ONLY the four cursor keys — no edit / modifier / danger keys", () => {
    render(<CursorPad onCursor={onCursorMock} sizePx={144} />);
    const pad = screen.getByTestId("remote-input-cursor-pad");

    const buttons = within(pad).getAllByRole("button");
    expect(buttons).toHaveLength(4);

    for (const forbidden of [
      "remote-input-key-ctrl",
      "remote-input-key-shift",
      "remote-input-key-commodore",
      "remote-input-key-ins",
      "remote-input-key-del",
      "remote-input-key-restore",
      "remote-input-key-run-stop",
    ]) {
      expect(within(pad).queryByTestId(forbidden)).toBeNull();
    }
  });

  it("gives every cursor key an unambiguous accessible label distinct from the joystick pad", () => {
    render(<CursorPad onCursor={onCursorMock} sizePx={144} />);
    expect(screen.getByTestId("remote-input-key-cursor-up")).toHaveAttribute("aria-label", "Cursor up");
    expect(screen.getByTestId("remote-input-key-cursor-left")).toHaveAttribute("aria-label", "Cursor left");
  });
});
