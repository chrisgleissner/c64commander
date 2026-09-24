/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it } from "vitest";

import { resolveSafeAreaCollisionPadding } from "@/lib/ui/popperCollisionPadding";

describe("resolveSafeAreaCollisionPadding", () => {
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

  it("reads an unset or unparsable inset as no padding", () => {
    document.documentElement.style.setProperty("--safe-area-inset-top", "env(safe-area-inset-top, 0px)");

    expect(resolveSafeAreaCollisionPadding()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});
