/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { fitJoystickControls, MIN_FITTED_CONTROL_PX } from "@/lib/remoteInput/joystickFit";

const base = { controlPx: 172, firePx: 120, gapPx: 16, availableWidthPx: 304, availableHeightPx: 400 };

describe("fitJoystickControls", () => {
  it("leaves the controls alone while the available space is unmeasured", () => {
    expect(fitJoystickControls({ ...base, availableWidthPx: 0, availableHeightPx: 0 })).toEqual({
      controlPx: 172,
      firePx: 120,
    });
  });

  it("never grows the controls into spare space", () => {
    expect(fitJoystickControls({ ...base, availableWidthPx: 900, availableHeightPx: 900 })).toEqual({
      controlPx: 172,
      firePx: 120,
    });
  });

  it("shrinks the stick and FIRE together until both fit the width", () => {
    const fit = fitJoystickControls(base);
    expect(fit.controlPx + fit.firePx + base.gapPx).toBeLessThanOrEqual(base.availableWidthPx);
    expect(fit.firePx / fit.controlPx).toBeCloseTo(120 / 172, 1);
  });

  it("keeps the side column's minimum width when FIRE alone would leave it narrower", () => {
    const fit = fitJoystickControls({ ...base, sideMinPx: 132 });
    expect(fit.controlPx).toBeLessThanOrEqual(base.availableWidthPx - base.gapPx - 132);
    expect(fit.controlPx).toBeGreaterThan(MIN_FITTED_CONTROL_PX);
  });

  it("shrinks the stick to the available height", () => {
    const fit = fitJoystickControls({ ...base, availableWidthPx: 900, availableHeightPx: 140 });
    expect(fit.controlPx).toBe(140);
    expect(fit.firePx).toBe(97);
  });

  it("does not shrink below a usable stick even when the space is smaller", () => {
    expect(fitJoystickControls({ ...base, availableHeightPx: 40 }).controlPx).toBe(MIN_FITTED_CONTROL_PX);
  });
});
