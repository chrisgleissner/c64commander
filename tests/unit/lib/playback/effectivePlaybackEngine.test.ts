/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { effectivePlaybackEngine } from "@/lib/playback/effectivePlaybackEngine";
import { preRouteEngine } from "@/lib/playback/playbackEngineRouting";
import { savePlaybackEngine } from "@/lib/config/appSettings";
import { saveStartupModeByUser } from "@/lib/appMode/appModeStore";

describe("effectivePlaybackEngine", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => saveStartupModeByUser("default"));

  it("SPM-PLAY-06 SID Player plays a SID here without a notice, whatever engine is stored", () => {
    savePlaybackEngine("c64");
    saveStartupModeByUser("sid-player");
    expect(effectivePlaybackEngine()).toBe("local");
    expect(
      preRouteEngine({
        category: "sid",
        engine: effectivePlaybackEngine(),
        localSupported: true,
        noDeviceConnected: true,
      }),
    ).toEqual({ route: "local", notice: null });
  });

  it("SPM-PLAY-06 the stored engine choice survives SID Player and applies again in the Full App", () => {
    savePlaybackEngine("c64");
    saveStartupModeByUser("sid-player");
    saveStartupModeByUser("default");
    expect(effectivePlaybackEngine()).toBe("c64");
    expect(localStorage.getItem("c64u_playback_engine")).toBe("c64");
  });

  it("SPM-PLAY-06 the Full App without a device still says the tune plays on the phone", () => {
    savePlaybackEngine("c64");
    expect(
      preRouteEngine({
        category: "sid",
        engine: effectivePlaybackEngine(),
        localSupported: true,
        noDeviceConnected: true,
      }).notice,
    ).toBe("no-device-local-sid");
  });
});
