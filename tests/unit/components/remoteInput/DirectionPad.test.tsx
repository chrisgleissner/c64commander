/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DirectionPad, type DirectionPadCell } from "@/components/remoteInput/DirectionPad";

const renderSingleCell = (overrides: Partial<DirectionPadCell> = {}) => {
  const cell: DirectionPadCell = {
    gridArea: "c",
    key: "c",
    testId: "dpad-cell",
    ariaLabel: "Test cell",
    label: "X",
    onPressStart: vi.fn(),
    onPressEnd: vi.fn(),
    onActivate: vi.fn(),
    ...overrides,
  };
  render(<DirectionPad cells={[cell]} sizePx={90} gridTemplateAreas={'"c"'} testId="dpad" />);
  return { cell, button: screen.getByTestId("dpad-cell") };
};

describe("DirectionPad", () => {
  afterEach(() => cleanup());

  it("HARD19-002: a drag-off release does not swallow the next keypad/synthetic activation", () => {
    const { cell, button } = renderSingleCell();

    // Touch-press the cell (drives onPressStart, arms the pointer-handled ref).
    fireEvent.pointerDown(button, { pointerId: 1, clientX: 45, clientY: 45 });
    expect(cell.onPressStart).toHaveBeenCalledTimes(1);

    // Lift with the finger dragged OFF the cell. jsdom's getBoundingClientRect
    // is the (0,0,0,0) origin rect, so (500,500) reads as outside — the drag-off
    // case. The browser synthesizes no click for an off-element release.
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 500, clientY: 500 });
    expect(cell.onPressEnd).toHaveBeenCalledTimes(1);

    // The next click-only activation (keypad/focus-ring Enter/Space, assistive
    // tech, or the E2E synthetic click) must NOT be swallowed.
    fireEvent.click(button);
    expect(cell.onActivate).toHaveBeenCalledTimes(1);
  });

  it("still suppresses the trailing synthetic click of an in-bounds touch tap (no double-act)", () => {
    const { cell, button } = renderSingleCell();
    // Give the button a real rect so an in-bounds release is detectable.
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 90,
      bottom: 90,
      width: 90,
      height: 90,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.pointerDown(button, { pointerId: 1, clientX: 45, clientY: 45 });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 45, clientY: 45 }); // released inside
    // The touch's own trailing synthetic click is suppressed — the press was
    // already handled by onPressStart.
    fireEvent.click(button);
    expect(cell.onActivate).not.toHaveBeenCalled();
  });

  it("fires onActivate for a pure keypad click with no preceding pointer press", () => {
    const { cell, button } = renderSingleCell();
    fireEvent.click(button);
    expect(cell.onActivate).toHaveBeenCalledTimes(1);
    expect(cell.onPressStart).not.toHaveBeenCalled();
  });
});
