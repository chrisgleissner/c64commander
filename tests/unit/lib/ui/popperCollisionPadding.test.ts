/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  resetSafeAreaCollisionPaddingForTests,
  resolveSafeAreaCollisionPadding,
} from "@/lib/ui/popperCollisionPadding";

describe("resolveSafeAreaCollisionPadding", () => {
  beforeEach(() => resetSafeAreaCollisionPaddingForTests());

  afterEach(() => {
    document.documentElement.style.removeProperty("--safe-area-inset-top");
    document.documentElement.style.removeProperty("--safe-area-inset-bottom");
  });

  it("keeps menus clear of the system bars the app draws under", () => {
    document.documentElement.style.setProperty("--safe-area-inset-top", "30px");
    document.documentElement.style.setProperty("--safe-area-inset-bottom", "12px");

    expect(resolveSafeAreaCollisionPadding()).toEqual({ top: 30, right: 0, bottom: 12, left: 0 });
  });

  it("also keeps them clear of the keypad guidance bar while it shows", () => {
    document.documentElement.style.setProperty("--safe-area-inset-bottom", "12px");
    document.documentElement.style.setProperty(
      "--keypad-guidance-reserved-height",
      "var(--keypad-guidance-bar-height)",
    );
    const bar = document.createElement("div");
    bar.setAttribute("data-testid", "keypad-guidance-bar");
    bar.setAttribute("data-visible", "true");
    bar.getBoundingClientRect = () => ({ height: 26 }) as DOMRect;
    document.body.appendChild(bar);
    try {
      expect(resolveSafeAreaCollisionPadding().bottom).toBe(38);
    } finally {
      bar.remove();
      document.documentElement.style.removeProperty("--keypad-guidance-reserved-height");
    }
  });

  it("keeps them clear of the tab bar and the guidance bar above it", () => {
    const place = (testId: string, top: number, visible?: boolean) => {
      const element = document.createElement("div");
      element.setAttribute("data-testid", testId);
      if (visible) element.setAttribute("data-visible", "true");
      element.getBoundingClientRect = () => ({ top, height: 427 - top }) as DOMRect;
      document.body.appendChild(element);
      return element;
    };
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 427 });
    const tabBar = place("tab-bar", 379);
    try {
      expect(resolveSafeAreaCollisionPadding().bottom).toBe(48);
      resetSafeAreaCollisionPaddingForTests();
      const guidance = place("keypad-guidance-bar", 353, true);
      try {
        expect(resolveSafeAreaCollisionPadding().bottom).toBe(74);
      } finally {
        guidance.remove();
      }
    } finally {
      tabBar.remove();
      Object.defineProperty(window, "innerHeight", { configurable: true, value: originalHeight });
    }
  });

  it("keeps a menu opened in a dialog clear of the toast strip above the guidance bar", () => {
    document.documentElement.style.setProperty("--safe-area-inset-bottom", "12px");
    document.documentElement.style.setProperty("--app-toast-reserved-height", "64px");
    try {
      expect(resolveSafeAreaCollisionPadding().bottom).toBe(76);
    } finally {
      document.documentElement.style.removeProperty("--app-toast-reserved-height");
    }
  });

  it("reads an unset or unparsable inset as no padding", () => {
    document.documentElement.style.setProperty("--safe-area-inset-top", "env(safe-area-inset-top, 0px)");

    expect(resolveSafeAreaCollisionPadding()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});
