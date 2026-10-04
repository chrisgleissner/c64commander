/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createTabJumpShortcut } from "@/lib/navigation/tabRoutes";
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
