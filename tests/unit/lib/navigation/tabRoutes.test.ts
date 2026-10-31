/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTabJumpShortcut,
  isTabPathVisible,
  resolveSwipeTarget,
  TAB_ROUTES,
  visibleTabIndexes,
} from "@/lib/navigation/tabRoutes";
import { subscribePageReset } from "@/lib/navigation/pageReset";

describe("createTabJumpShortcut", () => {
  afterEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("navigates to another tab without resetting any page", () => {
    window.history.pushState({}, "", "/play");
    const navigate = vi.fn();
    const resets: number[] = [];
    const unsubscribe = subscribePageReset((index) => resets.push(index));

    createTabJumpShortcut(navigate)(2);
    unsubscribe();

    expect(navigate).toHaveBeenCalledWith("/disks");
    expect(resets).toEqual([]);
  });

  it("asks the page on screen to open fresh when its own digit is pressed", () => {
    window.history.pushState({}, "", "/play");
    const navigate = vi.fn();
    const resets: number[] = [];
    const unsubscribe = subscribePageReset((index) => resets.push(index));

    createTabJumpShortcut(navigate)(1);
    unsubscribe();

    expect(resets).toEqual([1]);
    expect(navigate).toHaveBeenCalledWith("/play");
  });

  it("ignores a digit with no tab", () => {
    const navigate = vi.fn();
    createTabJumpShortcut(navigate)(9);
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("visible tabs", () => {
  it("SPM-NAV-01 the Full App shows every tab", () => {
    expect(visibleTabIndexes("full")).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("SPM-NAV-01 SID Player shows Play, Settings and Docs", () => {
    expect(visibleTabIndexes("sid-player").map((index) => TAB_ROUTES[index].label)).toEqual([
      "Play",
      "Settings",
      "Docs",
    ]);
  });

  it("SPM-NAV-02 the swipe target steps over hidden tabs and wraps within the visible set", () => {
    const visible = visibleTabIndexes("sid-player");
    expect(resolveSwipeTarget(1, 1, visible)).toBe(4);
    expect(resolveSwipeTarget(4, 1, visible)).toBe(5);
    expect(resolveSwipeTarget(5, 1, visible)).toBe(1);
    expect(resolveSwipeTarget(1, -1, visible)).toBe(5);
  });

  it("SPM-NAV-02 the swipe target is unchanged without a visible set", () => {
    expect(resolveSwipeTarget(0, -1)).toBe(5);
    expect(resolveSwipeTarget(5, 1)).toBe(0);
    expect(resolveSwipeTarget(2, 1)).toBe(3);
  });

  it("SPM-NAV-01 a path the mode hides is not a visible tab path", () => {
    expect(isTabPathVisible("/disks", "sid-player")).toBe(false);
    expect(isTabPathVisible("/", "sid-player")).toBe(false);
    expect(isTabPathVisible("/settings/open-source-licenses", "sid-player")).toBe(true);
    expect(isTabPathVisible("/unknown", "sid-player")).toBe(true);
  });
});
