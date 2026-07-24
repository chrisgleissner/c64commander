/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AvMirrorMinimap } from "@/components/streams/AvMirrorMinimap";

vi.mock("@/hooks/useAvMirror", () => ({ useAvMirrorCanvas: vi.fn() }));

const stubBounds = (el: HTMLElement, width: number, height: number) => {
  el.setPointerCapture = vi.fn();
  el.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
};

describe("AvMirrorMinimap", () => {
  beforeEach(() => vi.clearAllMocks());

  it("draws the viewport rectangle from the current zoom/pan", () => {
    render(<AvMirrorMinimap viewport={{ scale: 2, cx: 0.5, cy: 0.5 }} onSeek={vi.fn()} />);
    const rect = screen.getByTestId("av-mirror-minimap-viewport");
    expect(rect.style.left).toBe("25%");
    expect(rect.style.top).toBe("25%");
    expect(rect.style.width).toBe("50%");
    expect(rect.style.height).toBe("50%");
  });

  it("seeks to normalized coordinates on pointer down and drag, clamped to [0,1]", () => {
    const onSeek = vi.fn();
    render(<AvMirrorMinimap viewport={{ scale: 2, cx: 0.5, cy: 0.5 }} onSeek={onSeek} />);
    const map = screen.getByTestId("av-mirror-minimap");
    stubBounds(map, 200, 100);

    fireEvent.pointerDown(map, { clientX: 100, clientY: 50, pointerId: 1 });
    expect(onSeek).toHaveBeenLastCalledWith(0.5, 0.5);

    fireEvent.pointerMove(map, { clientX: 400, clientY: 400, buttons: 1 });
    expect(onSeek).toHaveBeenLastCalledWith(1, 1); // clamped

    onSeek.mockClear();
    fireEvent.pointerMove(map, { clientX: 10, clientY: 10, buttons: 0 }); // not dragging
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("ignores interaction when the element has no measured size", () => {
    const onSeek = vi.fn();
    render(<AvMirrorMinimap viewport={{ scale: 1, cx: 0.5, cy: 0.5 }} onSeek={onSeek} />);
    const map = screen.getByTestId("av-mirror-minimap");
    map.setPointerCapture = vi.fn();
    // jsdom's default getBoundingClientRect returns all-zero bounds.
    fireEvent.pointerDown(map, { clientX: 5, clientY: 5, pointerId: 1 });
    expect(onSeek).not.toHaveBeenCalled();
  });
});
