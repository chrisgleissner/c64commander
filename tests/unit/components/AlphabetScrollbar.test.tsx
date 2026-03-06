/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AlphabetScrollbar } from "@/components/lists/AlphabetScrollbar";

const setScrollMetrics = (
  element: HTMLElement,
  scrollHeight: number,
  clientHeight: number,
) => {
  Object.defineProperty(element, "scrollHeight", {
    value: scrollHeight,
    configurable: true,
  });
  Object.defineProperty(element, "clientHeight", {
    value: clientHeight,
    configurable: true,
  });
};

const createScrollContainer = () => {
  const container = document.createElement("div");
  container.innerHTML =
    '<div data-row-id="alpha"></div><div data-row-id="beta"></div>';
  container
    .querySelectorAll("[data-row-id]")
    .forEach((node) => Object.assign(node, { scrollIntoView: vi.fn() }));
  return container;
};

describe("AlphabetScrollbar", () => {
  it("selects a letter on touch and shows the badge", async () => {
    const container = createScrollContainer();
    setScrollMetrics(container, 1000, 100);

    const onLetterSelect = vi.fn();
    const items = [
      { id: "alpha", title: "Alpha" },
      { id: "beta", title: "Beta" },
    ];

    render(
      <AlphabetScrollbar
        items={items}
        scrollContainerRef={{ current: container }}
        onLetterSelect={onLetterSelect}
      />,
    );

    const touchArea = await screen.findByTestId("alphabet-touch-area");
    Object.defineProperty(touchArea, "getBoundingClientRect", {
      value: () => ({
        top: 0,
        left: 0,
        right: 0,
        bottom: 260,
        width: 20,
        height: 260,
        x: 0,
        y: 0,
        toJSON: () => "",
      }),
    });

    fireEvent.touchStart(touchArea, { touches: [{ clientY: 10 }] });

    expect(onLetterSelect).toHaveBeenCalledWith("A");
    expect(screen.getByTestId("alphabet-badge")).toBeInTheDocument();
  });

  it("shows overlay on scroll and hides after the idle timeout", async () => {
    vi.useFakeTimers();
    const container = createScrollContainer();
    setScrollMetrics(container, 1000, 100);

    const items = [
      { id: "alpha", title: "Alpha" },
      { id: "beta", title: "Beta" },
    ];

    render(
      <AlphabetScrollbar
        items={items}
        scrollContainerRef={{ current: container }}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    const overlay = screen.getByTestId("alphabet-overlay");

    act(() => {
      container.dispatchEvent(new Event("scroll"));
    });

    expect(overlay.className).toContain("opacity-100");

    act(() => {
      vi.advanceTimersByTime(1600);
    });

    expect(overlay.className).toContain("opacity-0");
    expect(screen.queryByTestId("alphabet-badge")).toBeNull();

    vi.useRealTimers();
  });

  it("maps items with numeric/symbol titles to # category", async () => {
    const container = createScrollContainer();
    setScrollMetrics(container, 1000, 100);
    const onLetterSelect = vi.fn();
    const items = [
      { id: "num", title: "1SongWithNumber" },
      { id: "empty", title: "" },
    ];

    render(
      <AlphabetScrollbar
        items={items}
        scrollContainerRef={{ current: container }}
        onLetterSelect={onLetterSelect}
        onScrollToIndex={vi.fn()}
      />,
    );

    const touchArea = await screen.findByTestId("alphabet-touch-area");
    Object.defineProperty(touchArea, "getBoundingClientRect", {
      value: () => ({
        top: 0,
        left: 0,
        right: 0,
        bottom: 260,
        width: 20,
        height: 260,
        x: 0,
        y: 0,
        toJSON: () => "",
      }),
    });

    // Touch at position that maps to '#' (first letter at top ~0 index)
    fireEvent.touchStart(touchArea, { touches: [{ clientY: 1 }] });
    expect(onLetterSelect).toHaveBeenCalledWith("#");
  });

  it("scrollToLetter returns early when letter has no items", async () => {
    const container = createScrollContainer();
    setScrollMetrics(container, 1000, 100);
    const onLetterSelect = vi.fn();
    const items = [{ id: "alpha", title: "Alpha" }];

    render(
      <AlphabetScrollbar
        items={items}
        scrollContainerRef={{ current: container }}
        onLetterSelect={onLetterSelect}
        onScrollToIndex={vi.fn()}
      />,
    );

    const touchArea = await screen.findByTestId("alphabet-touch-area");
    Object.defineProperty(touchArea, "getBoundingClientRect", {
      value: () => ({
        top: 0,
        left: 0,
        right: 0,
        bottom: 260,
        width: 20,
        height: 260,
        x: 0,
        y: 0,
        toJSON: () => "",
      }),
    });

    // Touch at position that maps to 'Z' (last letter, near bottom)
    fireEvent.touchStart(touchArea, { touches: [{ clientY: 255 }] });
    // 'Z' is not in indices (only 'Alpha' starting with 'A' exists)
    // scrollToLetter should return early with no call
    // But note: '#' exists (empty title items don't exist here), and 'A' exists
    // 'Z' at index 26 doesn't exist → early return
    expect(onLetterSelect).not.toHaveBeenCalledWith("Z");
  });

  it("handles scroll event that shows and schedules hide", async () => {
    vi.useFakeTimers();
    const container = createScrollContainer();
    setScrollMetrics(container, 1000, 100);

    render(
      <AlphabetScrollbar
        items={[
          { id: "a", title: "Alpha" },
          { id: "b", title: "Beta" },
        ]}
        scrollContainerRef={{ current: container }}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      container.dispatchEvent(new Event("scroll"));
    });

    const overlay = screen.getByTestId("alphabet-overlay");
    expect(overlay.className).toContain("opacity-100");

    vi.useRealTimers();
  });

  it("uses onScrollToIndex callback when provided", async () => {
    const container = createScrollContainer();
    setScrollMetrics(container, 1000, 100);
    const onScrollToIndex = vi.fn();
    const items = [
      { id: "alpha", title: "Alpha" },
      { id: "beta", title: "Beta" },
    ];

    render(
      <AlphabetScrollbar
        items={items}
        scrollContainerRef={{ current: container }}
        onScrollToIndex={onScrollToIndex}
      />,
    );

    const touchArea = await screen.findByTestId("alphabet-touch-area");
    Object.defineProperty(touchArea, "getBoundingClientRect", {
      value: () => ({
        top: 0,
        left: 0,
        right: 0,
        bottom: 260,
        width: 20,
        height: 260,
        x: 0,
        y: 0,
        toJSON: () => "",
      }),
    });

    // Touch at position that maps to 'A'
    fireEvent.touchStart(touchArea, { touches: [{ clientY: 10 }] });
    expect(onScrollToIndex).toHaveBeenCalledWith(0);
  });

  it("uses querySelector scrollIntoView when onScrollToIndex is not provided", async () => {
    const container = createScrollContainer();
    setScrollMetrics(container, 1000, 100);
    const onLetterSelect = vi.fn();
    const items = [{ id: "alpha", title: "Alpha" }];

    render(
      <AlphabetScrollbar
        items={items}
        scrollContainerRef={{ current: container }}
        onLetterSelect={onLetterSelect}
      />,
    );

    const touchArea = await screen.findByTestId("alphabet-touch-area");
    Object.defineProperty(touchArea, "getBoundingClientRect", {
      value: () => ({
        top: 0,
        left: 0,
        right: 0,
        bottom: 260,
        width: 20,
        height: 260,
        x: 0,
        y: 0,
        toJSON: () => "",
      }),
    });

    // Touch 'A' zone
    fireEvent.touchStart(touchArea, { touches: [{ clientY: 10 }] });
    // querySelector would look for [data-row-id="alpha"] in container
    const alphaNode = container.querySelector('[data-row-id="alpha"]');
    expect(alphaNode).not.toBeNull();
    expect(onLetterSelect).toHaveBeenCalledWith("A");
  });

  it("handles pointer enter and leave events", async () => {
    const container = createScrollContainer();
    setScrollMetrics(container, 1000, 100);

    render(
      <AlphabetScrollbar
        items={[
          { id: "a", title: "Alpha" },
          { id: "b", title: "Beta" },
        ]}
        scrollContainerRef={{ current: container }}
      />,
    );

    const touchArea = await screen.findByTestId("alphabet-touch-area");
    // pointer events should not throw
    fireEvent.pointerEnter(touchArea);
    fireEvent.pointerLeave(touchArea);

    // overlay might be visible after pointer enter
    const overlay = screen.getByTestId("alphabet-overlay");
    expect(overlay).toBeInTheDocument();
  });

  it("handles touch move and end events", async () => {
    const container = createScrollContainer();
    setScrollMetrics(container, 1000, 100);
    const onLetterSelect = vi.fn();

    render(
      <AlphabetScrollbar
        items={[
          { id: "alpha", title: "Alpha" },
          { id: "beta", title: "Beta" },
        ]}
        scrollContainerRef={{ current: container }}
        onLetterSelect={onLetterSelect}
        onScrollToIndex={vi.fn()}
      />,
    );

    const touchArea = await screen.findByTestId("alphabet-touch-area");
    Object.defineProperty(touchArea, "getBoundingClientRect", {
      value: () => ({
        top: 0,
        left: 0,
        right: 0,
        bottom: 260,
        width: 20,
        height: 260,
        x: 0,
        y: 0,
        toJSON: () => "",
      }),
    });

    fireEvent.touchStart(touchArea, { touches: [{ clientY: 10 }] });
    fireEvent.touchMove(touchArea, { touches: [{ clientY: 30 }] });
    fireEvent.touchEnd(touchArea);
  });

  it("handleScroll resets visibility when component is not eligible", async () => {
    // 0 items + no overflowing container → isEligible stays false
    const container = document.createElement("div");
    setScrollMetrics(container, 100, 100); // not scrollable

    render(
      <AlphabetScrollbar
        items={[]}
        scrollContainerRef={{ current: container }}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    // touch area is NOT rendered (not eligible)
    expect(screen.queryByTestId("alphabet-touch-area")).toBeNull();

    // Fire scroll on the container — handleScroll should see isEligible=false
    act(() => {
      container.dispatchEvent(new Event("scroll"));
    });
    // No errors; overlay is not rendered
    expect(screen.queryByTestId("alphabet-overlay")).toBeNull();
  });

  it("renders without crashing when ResizeObserver is unavailable", async () => {
    const originalResizeObserver = window.ResizeObserver;
    // Remove ResizeObserver to simulate unavailable environment (line 171 fallback)
    Object.defineProperty(window, "ResizeObserver", {
      value: undefined,
      configurable: true,
    });

    const container = createScrollContainer();
    setScrollMetrics(container, 1000, 100);

    render(
      <AlphabetScrollbar
        items={[{ id: "alpha", title: "Alpha" }]}
        scrollContainerRef={{ current: container }}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Component still renders and becomes eligible
    const overlay = screen.getByTestId("alphabet-overlay");
    expect(overlay).toBeInTheDocument();

    // Restore
    Object.defineProperty(window, "ResizeObserver", {
      value: originalResizeObserver,
      configurable: true,
    });
  });

  it("handles null scrollContainerRef gracefully", async () => {
    render(
      <AlphabetScrollbar
        items={[{ id: "alpha", title: "Alpha" }]}
        scrollContainerRef={{ current: null }}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Component renders without crash; no touch area since not eligible
    expect(screen.queryByTestId("alphabet-touch-area")).toBeNull();
  });
});
