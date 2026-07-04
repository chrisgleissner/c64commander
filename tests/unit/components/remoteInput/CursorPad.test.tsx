/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CursorPad } from "@/components/remoteInput/CursorPad";

const onCursorMock = vi.fn();

describe("CursorPad", () => {
  beforeEach(() => onCursorMock.mockClear());

  it("emits one keyboard cursor movement per tap, in each of the four directions", () => {
    render(<CursorPad onCursor={onCursorMock} sizePx={144} />);

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
