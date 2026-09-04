/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import { confirmNavigation, registerNavigationGuard } from "@/lib/navigation/navigationGuards";

describe("navigationGuards", () => {
  it("blocks large playlist import navigation until the warning guard explicitly allows it", () => {
    const unregister = registerNavigationGuard(vi.fn(() => false));

    expect(confirmNavigation()).toBe(false);

    unregister();
  });

  it("allows navigation after guard removal", () => {
    const unregister = registerNavigationGuard(() => true);
    unregister();

    expect(confirmNavigation()).toBe(true);
  });

  it("stops evaluating guards after the first rejection", () => {
    const first = vi.fn(() => false);
    const second = vi.fn(() => true);
    const unregisterFirst = registerNavigationGuard(first);
    const unregisterSecond = registerNavigationGuard(second);

    expect(confirmNavigation()).toBe(false);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();

    unregisterSecond();
    unregisterFirst();
  });
});
