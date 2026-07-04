/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { vibrateTap } from "@/lib/remoteInput/haptics";

describe("vibrateTap", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls navigator.vibrate with the given duration when available", () => {
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", { vibrate });
    vibrateTap(15);
    expect(vibrate).toHaveBeenCalledWith(15);
  });

  it("defaults to a short pulse", () => {
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", { vibrate });
    vibrateTap();
    expect(vibrate).toHaveBeenCalledWith(12);
  });

  it("is a no-op when the Vibration API is absent", () => {
    vi.stubGlobal("navigator", {});
    expect(() => vibrateTap(10)).not.toThrow();
  });

  it("swallows a runtime throw from vibrate (WebViews with vibration disabled)", () => {
    const vibrate = vi.fn(() => {
      throw new Error("vibration disabled");
    });
    vi.stubGlobal("navigator", { vibrate });
    expect(() => vibrateTap(10)).not.toThrow();
  });
});
