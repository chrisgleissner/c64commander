/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  HOME_CPU_SPEED_SLIDER_PROBE_PREFIX,
  createHomeCpuSpeedSliderProbeSnapshot,
  formatHomeCpuSpeedSliderProbe,
} from "@/pages/home/components/homeCpuSpeedSliderProbe";

describe("homeCpuSpeedSliderProbe", () => {
  it("creates an idle snapshot from the authoritative value", () => {
    expect(createHomeCpuSpeedSliderProbeSnapshot("2")).toEqual({
      authoritativeValue: "2",
      completedAtIso: null,
      displayValue: "2",
      durationMs: null,
      errorMessage: null,
      phase: "idle",
      releasedAtIso: null,
      targetValue: "2",
    });
  });

  it("formats the snapshot as a stable Maestro-friendly JSON line", () => {
    const text = formatHomeCpuSpeedSliderProbe(
      createHomeCpuSpeedSliderProbeSnapshot("4", {
        completedAtIso: "2026-05-06T14:00:01.100Z",
        displayValue: "8",
        durationMs: 412,
        phase: "success",
        releasedAtIso: "2026-05-06T14:00:00.688Z",
        targetValue: "8",
      }),
    );

    expect(text).toBe(
      `${HOME_CPU_SPEED_SLIDER_PROBE_PREFIX}{"authoritativeValue":"4","completedAtIso":"2026-05-06T14:00:01.100Z","displayValue":"8","durationMs":412,"errorMessage":null,"phase":"success","releasedAtIso":"2026-05-06T14:00:00.688Z","targetValue":"8"}`,
    );
  });
});
