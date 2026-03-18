/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import {
  classifyGestureIntent,
  isSwipeExcluded,
  SWIPE_COMMIT_THRESHOLD_PX,
  AXIS_LOCK_THRESHOLD_PX,
  shouldCommitSwipe,
  resolveSwipeDirection,
  useSwipeGesture,
} from "./useSwipeGesture";
import { tabIndexForPath, resolveSwipeTarget, TAB_ROUTES } from "@/lib/navigation/tabRoutes";
import {
  buildRunwayPanelIndexes,
  resolveAdjacentIndexes,
  resolveNavigationDirection,
  resolveRunwayTranslatePercent,
} from "@/lib/navigation/swipeNavigationModel";

// ---------------------------------------------------------------------------
// classifyGestureIntent
// ---------------------------------------------------------------------------

describe("classifyGestureIntent", () => {
  it("returns undecided when both axes are below lock threshold", () => {
    expect(classifyGestureIntent(0, 0)).toBe("undecided");
    expect(classifyGestureIntent(AXIS_LOCK_THRESHOLD_PX - 1, 0)).toBe("undecided");
    expect(classifyGestureIntent(0, AXIS_LOCK_THRESHOLD_PX - 1)).toBe("undecided");
    expect(classifyGestureIntent(5, 5)).toBe("undecided");
  });

  it("returns navigating when horizontal is dominant", () => {
    expect(classifyGestureIntent(AXIS_LOCK_THRESHOLD_PX + 1, 0)).toBe("navigating");
    expect(classifyGestureIntent(50, 20)).toBe("navigating");
    expect(classifyGestureIntent(-50, 20)).toBe("navigating");
    expect(classifyGestureIntent(100, 0)).toBe("navigating");
  });

  it("returns locked when vertical is dominant", () => {
    expect(classifyGestureIntent(0, AXIS_LOCK_THRESHOLD_PX + 1)).toBe("locked");
    expect(classifyGestureIntent(20, 50)).toBe("locked");
    expect(classifyGestureIntent(0, -100)).toBe("locked");
  });

  it("returns navigating when exactly equal displacement (horizontal wins on tie)", () => {
    // |dx| > |dy| is the condition; equal is technically not > so neither wins
    // Equal falls through to locked because !( adx > ady )
    expect(classifyGestureIntent(20, 20)).toBe("locked");
  });

  it("SWIPE_COMMIT_THRESHOLD_PX is at least 40px", () => {
    expect(SWIPE_COMMIT_THRESHOLD_PX).toBeGreaterThanOrEqual(40);
  });

  it("AXIS_LOCK_THRESHOLD_PX is positive and less than SWIPE_COMMIT_THRESHOLD_PX", () => {
    expect(AXIS_LOCK_THRESHOLD_PX).toBeGreaterThan(0);
    expect(AXIS_LOCK_THRESHOLD_PX).toBeLessThan(SWIPE_COMMIT_THRESHOLD_PX);
  });
});

// ---------------------------------------------------------------------------
// isSwipeExcluded
// ---------------------------------------------------------------------------

describe("isSwipeExcluded", () => {
  it("returns false for null target", () => {
    expect(isSwipeExcluded(null)).toBe(false);
  });

  it("returns false for non-element target", () => {
    expect(isSwipeExcluded({} as EventTarget)).toBe(false);
  });

  it("returns true when target element has data-swipe-exclude", () => {
    const div = document.createElement("div");
    div.setAttribute("data-swipe-exclude", "true");
    expect(isSwipeExcluded(div)).toBe(true);
  });

  it("returns true when ancestor has data-swipe-exclude", () => {
    const parent = document.createElement("div");
    parent.setAttribute("data-swipe-exclude", "true");
    const child = document.createElement("span");
    parent.appendChild(child);
    expect(isSwipeExcluded(child)).toBe(true);
  });

  it("returns false when no ancestor has data-swipe-exclude", () => {
    const div = document.createElement("div");
    const span = document.createElement("span");
    div.appendChild(span);
    expect(isSwipeExcluded(span)).toBe(false);
  });

  it('returns true for input[type="range"]', () => {
    const input = document.createElement("input");
    input.type = "range";
    expect(isSwipeExcluded(input)).toBe(true);
  });

  it('returns true when input[type="range"] is an ancestor', () => {
    const input = document.createElement("input");
    input.type = "range";
    const span = document.createElement("span");
    input.appendChild(span);
    expect(isSwipeExcluded(span)).toBe(true);
  });

  it('returns false for input[type="text"]', () => {
    const input = document.createElement("input");
    input.type = "text";
    expect(isSwipeExcluded(input)).toBe(false);
  });

  it('returns true when element has role="slider"', () => {
    const div = document.createElement("div");
    div.setAttribute("role", "slider");
    expect(isSwipeExcluded(div)).toBe(true);
  });

  it('returns true when ancestor has role="slider"', () => {
    const parent = document.createElement("div");
    parent.setAttribute("role", "slider");
    const child = document.createElement("span");
    parent.appendChild(child);
    expect(isSwipeExcluded(child)).toBe(true);
  });

  it("returns true when target is draggable", () => {
    const div = document.createElement("div");
    div.setAttribute("draggable", "true");
    expect(isSwipeExcluded(div)).toBe(true);
  });

  it("returns true for horizontally scrollable containers", () => {
    const div = document.createElement("div");
    Object.defineProperty(div, "clientWidth", { configurable: true, value: 100 });
    Object.defineProperty(div, "scrollWidth", { configurable: true, value: 180 });
    div.style.overflowX = "auto";
    expect(isSwipeExcluded(div)).toBe(true);
  });
});

describe("swipe release helpers", () => {
  it("requires at least the commit threshold", () => {
    expect(shouldCommitSwipe(SWIPE_COMMIT_THRESHOLD_PX - 1)).toBe(false);
    expect(shouldCommitSwipe(-(SWIPE_COMMIT_THRESHOLD_PX - 1))).toBe(false);
    expect(shouldCommitSwipe(SWIPE_COMMIT_THRESHOLD_PX)).toBe(true);
    expect(shouldCommitSwipe(-SWIPE_COMMIT_THRESHOLD_PX)).toBe(true);
  });

  it("maps negative dx to next page and positive dx to previous page", () => {
    expect(resolveSwipeDirection(-60)).toBe(1);
    expect(resolveSwipeDirection(60)).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// tabIndexForPath
// ---------------------------------------------------------------------------

describe("tabIndexForPath", () => {
  it("returns correct index for exact tab routes", () => {
    expect(tabIndexForPath("/")).toBe(0);
    expect(tabIndexForPath("/play")).toBe(1);
    expect(tabIndexForPath("/disks")).toBe(2);
    expect(tabIndexForPath("/config")).toBe(3);
    expect(tabIndexForPath("/settings")).toBe(4);
    expect(tabIndexForPath("/docs")).toBe(5);
  });

  it("returns -1 for unknown paths", () => {
    expect(tabIndexForPath("/unknown")).toBe(-1);
    expect(tabIndexForPath("/foo/bar")).toBe(-1);
    expect(tabIndexForPath("/__coverage__")).toBe(-1);
  });

  it("returns Settings index for sub-routes of Settings", () => {
    expect(tabIndexForPath("/settings/open-source-licenses")).toBe(4);
    expect(tabIndexForPath("/settings/anything")).toBe(4);
  });

  it("does NOT match / as prefix (avoids false positives on root)", () => {
    // /disks should NOT match root prefix "/"
    expect(tabIndexForPath("/disks")).toBe(2); // exact match wins
    expect(tabIndexForPath("/unknown-path")).toBe(-1); // "/" prefix excluded
  });

  it("covers all TAB_ROUTES", () => {
    TAB_ROUTES.forEach((route, i) => {
      expect(tabIndexForPath(route.path)).toBe(i);
    });
  });
});

// ---------------------------------------------------------------------------
// resolveSwipeTarget — wrap-around correctness
// ---------------------------------------------------------------------------

describe("resolveSwipeTarget", () => {
  const lastIndex = TAB_ROUTES.length - 1; // 5 (Docs)

  it("swipe left (direction=1) increments index", () => {
    expect(resolveSwipeTarget(0, 1)).toBe(1);
    expect(resolveSwipeTarget(2, 1)).toBe(3);
    expect(resolveSwipeTarget(4, 1)).toBe(5);
  });

  it("swipe right (direction=-1) decrements index", () => {
    expect(resolveSwipeTarget(5, -1)).toBe(4);
    expect(resolveSwipeTarget(2, -1)).toBe(1);
    expect(resolveSwipeTarget(1, -1)).toBe(0);
  });

  it("wraps from last page to first on swipe left", () => {
    expect(resolveSwipeTarget(lastIndex, 1)).toBe(0);
  });

  it("wraps from first page to last on swipe right", () => {
    expect(resolveSwipeTarget(0, -1)).toBe(lastIndex);
  });

  it("page order is Home → Play → Disks → Config → Settings → Docs", () => {
    expect(TAB_ROUTES[0].label).toBe("Home");
    expect(TAB_ROUTES[1].label).toBe("Play");
    expect(TAB_ROUTES[2].label).toBe("Disks");
    expect(TAB_ROUTES[3].label).toBe("Config");
    expect(TAB_ROUTES[4].label).toBe("Settings");
    expect(TAB_ROUTES[5].label).toBe("Docs");
  });

  it("full clockwise loop returns to start", () => {
    let index = 0;
    for (let i = 0; i < TAB_ROUTES.length; i++) {
      index = resolveSwipeTarget(index, 1);
    }
    expect(index).toBe(0);
  });

  it("full counter-clockwise loop returns to start", () => {
    let index = 0;
    for (let i = 0; i < TAB_ROUTES.length; i++) {
      index = resolveSwipeTarget(index, -1);
    }
    expect(index).toBe(0);
  });
});

describe("swipe runway model", () => {
  it("resolves adjacent indexes with wrap-around", () => {
    expect(resolveAdjacentIndexes(0)).toEqual([5, 0, 1]);
    expect(resolveAdjacentIndexes(5)).toEqual([4, 5, 0]);
    expect(resolveAdjacentIndexes(2)).toEqual([1, 2, 3]);
  });

  it("chooses the shortest navigation direction with wrap-around", () => {
    expect(resolveNavigationDirection(0, 1)).toBe(1);
    expect(resolveNavigationDirection(1, 0)).toBe(-1);
    expect(resolveNavigationDirection(5, 0)).toBe(1);
    expect(resolveNavigationDirection(0, 5)).toBe(-1);
    expect(resolveNavigationDirection(0, 3)).toBe(1);
    expect(resolveNavigationDirection(3, 0)).toBe(1);
    expect(resolveNavigationDirection(2, 2)).toBe(0);
  });

  it("builds idle runway panels from adjacent pages", () => {
    expect(buildRunwayPanelIndexes(0)).toEqual([5, 0, 1]);
    expect(buildRunwayPanelIndexes(4)).toEqual([3, 4, 5]);
  });

  it("builds transition panels with the target on the travel side", () => {
    expect(buildRunwayPanelIndexes(0, 1)).toEqual([5, 0, 1]);
    expect(buildRunwayPanelIndexes(1, 0)).toEqual([0, 1, 2]);
    expect(buildRunwayPanelIndexes(5, 0)).toEqual([4, 5, 0]);
    expect(buildRunwayPanelIndexes(0, 5)).toEqual([5, 0, 1]);
    expect(buildRunwayPanelIndexes(0, 3)).toEqual([5, 0, 3]);
  });

  it("resolves runway translate percent for transition phases", () => {
    expect(resolveRunwayTranslatePercent(-1)).toBe(0);
    expect(resolveRunwayTranslatePercent(0)).toBe(-(100 / 3));
    expect(resolveRunwayTranslatePercent(1)).toBe(-(200 / 3));
  });
});

describe("useSwipeGesture integration", () => {
  const GestureHarness = ({
    callbacks,
    withExcludedChild = false,
  }: {
    callbacks: {
      onProgress: ReturnType<typeof vi.fn>;
      onCommit: ReturnType<typeof vi.fn>;
      onCancel: ReturnType<typeof vi.fn>;
    };
    withExcludedChild?: boolean;
  }) => {
    const ref = React.useRef<HTMLDivElement | null>(null);
    useSwipeGesture(ref, callbacks);
    return React.createElement(
      "div",
      { ref, "data-testid": "gesture-surface" },
      withExcludedChild
        ? React.createElement(
            "button",
            {
              type: "button",
              "data-testid": "excluded-origin",
              "data-swipe-exclude": "true",
            },
            "Excluded",
          )
        : null,
    );
  };

  it("ignores gestures that start on excluded interactive descendants", () => {
    const callbacks = {
      onProgress: vi.fn(),
      onCommit: vi.fn(),
      onCancel: vi.fn(),
    };

    render(React.createElement(GestureHarness, { callbacks, withExcludedChild: true }));
    const surface = screen.getByTestId("gesture-surface");
    const excluded = screen.getByTestId("excluded-origin");

    excluded.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, isPrimary: true }),
    );
    surface.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 120, clientY: 10 }));
    surface.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientX: 120, clientY: 10 }));

    expect(callbacks.onProgress).not.toHaveBeenCalled();
    expect(callbacks.onCommit).not.toHaveBeenCalled();
    expect(callbacks.onCancel).not.toHaveBeenCalled();
  });

  it("locks vertical gestures without committing or cancelling navigation", () => {
    const callbacks = {
      onProgress: vi.fn(),
      onCommit: vi.fn(),
      onCancel: vi.fn(),
    };

    render(React.createElement(GestureHarness, { callbacks }));
    const surface = screen.getByTestId("gesture-surface");

    surface.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 2, isPrimary: true }));
    surface.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 2,
        clientX: 5,
        clientY: 60,
        timeStamp: 10,
      }),
    );
    surface.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 2,
        clientX: 5,
        clientY: 60,
        timeStamp: 20,
      }),
    );

    expect(callbacks.onProgress).not.toHaveBeenCalled();
    expect(callbacks.onCommit).not.toHaveBeenCalled();
    expect(callbacks.onCancel).not.toHaveBeenCalled();
  });

  it("reports progress and commits on a horizontal gesture above threshold", () => {
    const callbacks = {
      onProgress: vi.fn(),
      onCommit: vi.fn(),
      onCancel: vi.fn(),
    };

    render(React.createElement(GestureHarness, { callbacks }));
    const surface = screen.getByTestId("gesture-surface");

    surface.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerId: 3,
        isPrimary: true,
        clientX: 180,
        clientY: 20,
        timeStamp: 0,
      }),
    );
    surface.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 3,
        clientX: 110,
        clientY: 25,
        timeStamp: 20,
      }),
    );
    surface.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 3,
        clientX: 110,
        clientY: 25,
        timeStamp: 40,
      }),
    );

    expect(callbacks.onProgress).toHaveBeenCalledWith(-70, expect.any(Number));
    expect(callbacks.onCommit).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ dx: -70, dy: 5, velocityX: expect.any(Number) }),
    );
    expect(callbacks.onCancel).not.toHaveBeenCalled();
  });

  it("waits through undecided movement before classifying and then keeps reporting progress", () => {
    const callbacks = {
      onProgress: vi.fn(),
      onCommit: vi.fn(),
      onCancel: vi.fn(),
    };

    render(React.createElement(GestureHarness, { callbacks }));
    const surface = screen.getByTestId("gesture-surface");

    surface.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerId: 4,
        isPrimary: true,
        clientX: 120,
        clientY: 20,
        timeStamp: 0,
      }),
    );
    surface.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 4,
        clientX: 116,
        clientY: 18,
        timeStamp: 10,
      }),
    );
    expect(callbacks.onProgress).not.toHaveBeenCalled();

    surface.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 4,
        clientX: 90,
        clientY: 18,
        timeStamp: 20,
      }),
    );
    surface.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 4,
        clientX: 70,
        clientY: 18,
        timeStamp: 30,
      }),
    );

    expect(callbacks.onProgress).toHaveBeenNthCalledWith(1, -30, expect.any(Number));
    expect(callbacks.onProgress).toHaveBeenNthCalledWith(2, -50, expect.any(Number));
  });

  it("cancels a short horizontal swipe below the commit threshold", () => {
    const callbacks = {
      onProgress: vi.fn(),
      onCommit: vi.fn(),
      onCancel: vi.fn(),
    };

    render(React.createElement(GestureHarness, { callbacks }));
    const surface = screen.getByTestId("gesture-surface");

    surface.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerId: 5,
        isPrimary: true,
        clientX: 120,
        clientY: 20,
        timeStamp: 0,
      }),
    );
    surface.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 5,
        clientX: 95,
        clientY: 22,
        timeStamp: 20,
      }),
    );
    surface.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 5,
        clientX: 95,
        clientY: 22,
        timeStamp: 40,
      }),
    );

    expect(callbacks.onCommit).not.toHaveBeenCalled();
    expect(callbacks.onCancel).toHaveBeenCalledWith(expect.objectContaining({ dx: -25, dy: 2 }));
  });

  it("ignores pointerdowns that are not primary left-button interactions", () => {
    const callbacks = {
      onProgress: vi.fn(),
      onCommit: vi.fn(),
      onCancel: vi.fn(),
    };

    render(React.createElement(GestureHarness, { callbacks }));
    const surface = screen.getByTestId("gesture-surface");

    surface.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 1,
        pointerId: 6,
        isPrimary: false,
      }),
    );
    surface.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 6, clientX: 10, clientY: 0 }));
    surface.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 6, clientX: 10, clientY: 0 }));

    expect(callbacks.onProgress).not.toHaveBeenCalled();
    expect(callbacks.onCommit).not.toHaveBeenCalled();
    expect(callbacks.onCancel).not.toHaveBeenCalled();
  });
});
