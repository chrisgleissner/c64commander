/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTabJumpShortcut, resetTabJumpHintForTests } from "@/lib/navigation/tabRoutes";
import { saveStartupModeByUser } from "@/lib/appMode/appModeStore";
import { toast } from "@/hooks/use-toast";

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

describe("tab jump shortcut in SID Player", () => {
  beforeEach(() => {
    localStorage.clear();
    saveStartupModeByUser("sid-player");
    resetTabJumpHintForTests();
    vi.mocked(toast).mockClear();
    window.history.pushState({}, "", "/play");
  });

  afterEach(() => {
    saveStartupModeByUser("default");
    window.history.pushState({}, "", "/");
  });

  it("SPM-NAV-03 digit jumps map to visible tabs in SID Player", () => {
    const navigate = vi.fn();
    const jump = createTabJumpShortcut(navigate);
    jump(0);
    jump(1);
    jump(2);
    expect(navigate.mock.calls.map(([path]) => path)).toEqual(["/play", "/settings", "/docs"]);
  });

  it("SPM-NAV-03 a digit past the visible tabs shows the hint once", () => {
    const navigate = vi.fn();
    const jump = createTabJumpShortcut(navigate);
    jump(3);
    jump(4);
    jump(5);
    expect(navigate).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Pages are on keys 1 to 3", informational: true }),
    );
  });

  it("SPM-NAV-03 the Full App never shows the hint and keeps all six digits", () => {
    saveStartupModeByUser("default");
    const navigate = vi.fn();
    const jump = createTabJumpShortcut(navigate);
    jump(0);
    jump(5);
    jump(9);
    expect(navigate.mock.calls.map(([path]) => path)).toEqual(["/", "/docs"]);
    expect(toast).not.toHaveBeenCalled();
  });
});
