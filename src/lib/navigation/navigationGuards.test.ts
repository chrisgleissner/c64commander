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
  it("blocks navigation when a registered guard rejects it", () => {
    const unregister = registerNavigationGuard(vi.fn(() => false));

    expect(confirmNavigation()).toBe(false);

    unregister();
  });

  it("allows navigation after guard removal", () => {
    const unregister = registerNavigationGuard(() => true);
    unregister();

    expect(confirmNavigation()).toBe(true);
  });
});
