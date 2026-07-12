/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KeyHoldButton } from "@/components/remoteInput/KeyHoldButton";

// jsdom's getBoundingClientRect() always returns an all-zero rect unless
// mocked, so a pointerup at (0, 0) reads as "released inside the button" and
// any non-zero coordinate reads as "released outside it" - exactly the
// geometric check KeyHoldButton uses to detect a drag-off.
const INSIDE = { clientX: 0, clientY: 0 };
const OUTSIDE = { clientX: 500, clientY: 500 };

describe("KeyHoldButton", () => {
  it("drives onHoldPress/onHoldRelease from a real pointer sequence and does not also fire onTap", () => {
    const onHoldPress = vi.fn();
    const onHoldRelease = vi.fn();
    const onTap = vi.fn();
    render(<KeyHoldButton data-testid="key" onHoldPress={onHoldPress} onHoldRelease={onHoldRelease} onTap={onTap} />);
    const button = screen.getByTestId("key");

    fireEvent.pointerDown(button, { pointerId: 1, ...INSIDE });
    expect(onHoldPress).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(button, { pointerId: 1, ...INSIDE });
    expect(onHoldRelease).toHaveBeenCalledTimes(1);
    // A pointerdown+pointerup over the SAME element synthesizes a real
    // click; onTap must not ALSO fire for it (would double-dispatch the key).
    fireEvent.click(button);
    expect(onTap).not.toHaveBeenCalled();
  });

  it("falls through to onTap for a keypad/assistive-tech click with no preceding pointerdown", () => {
    const onHoldPress = vi.fn();
    const onHoldRelease = vi.fn();
    const onTap = vi.fn();
    render(<KeyHoldButton data-testid="key" onHoldPress={onHoldPress} onHoldRelease={onHoldRelease} onTap={onTap} />);
    fireEvent.click(screen.getByTestId("key"));
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onHoldPress).not.toHaveBeenCalled();
    expect(onHoldRelease).not.toHaveBeenCalled();
  });

  it("routes every interaction through onTap when no hold handlers are given (e.g. SHIFT LOCK, cursor keys)", () => {
    const onTap = vi.fn();
    render(<KeyHoldButton data-testid="key" onTap={onTap} />);
    const button = screen.getByTestId("key");
    fireEvent.pointerDown(button, { pointerId: 1, ...INSIDE });
    fireEvent.pointerUp(button, { pointerId: 1, ...INSIDE });
    fireEvent.click(button);
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("resets the pointer-handled guard when a finger drags off the button before releasing, so the NEXT activation (e.g. a keyboard Enter) is not silently swallowed", () => {
    const onHoldPress = vi.fn();
    const onHoldRelease = vi.fn();
    const onTap = vi.fn();
    render(<KeyHoldButton data-testid="key" onHoldPress={onHoldPress} onHoldRelease={onHoldRelease} onTap={onTap} />);
    const button = screen.getByTestId("key");

    fireEvent.pointerDown(button, { pointerId: 1, ...INSIDE });
    // The finger drags off the button before lifting - pointer capture still
    // redirects pointerup HERE, but the browser does not synthesize a click
    // for a release outside the element, so none is fired in this test.
    fireEvent.pointerUp(button, { pointerId: 1, ...OUTSIDE });
    expect(onHoldRelease).toHaveBeenCalledTimes(1);

    // A later, unrelated activation (e.g. Enter/Space via assistive tech)
    // always arrives as a bare click with no preceding pointerdown. Before
    // the fix this was silently swallowed by the still-`true` guard.
    fireEvent.click(button);
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("resets the pointer-handled guard on pointercancel, so the NEXT activation still works", () => {
    const onHoldPress = vi.fn();
    const onHoldRelease = vi.fn();
    const onTap = vi.fn();
    render(<KeyHoldButton data-testid="key" onHoldPress={onHoldPress} onHoldRelease={onHoldRelease} onTap={onTap} />);
    const button = screen.getByTestId("key");

    fireEvent.pointerDown(button, { pointerId: 1, ...INSIDE });
    fireEvent.pointerCancel(button, { pointerId: 1 });
    expect(onHoldRelease).toHaveBeenCalledTimes(1);

    fireEvent.click(button);
    expect(onTap).toHaveBeenCalledTimes(1);
  });
});
