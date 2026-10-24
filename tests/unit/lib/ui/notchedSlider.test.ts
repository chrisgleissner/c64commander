/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { describe, expect, it } from "vitest";

import {
  NOTCH_REPEAT_STEP,
  nearestNotch,
  notchValueText,
  positionCss,
  repeatStep,
  snapToNotch,
  stepNotch,
  valueAtPosition,
  type Notch,
} from "@/lib/ui/notchedSlider";

const NOTCHES: Notch[] = [
  { id: "off", label: "Off", value: 0 },
  { id: "subtle", label: "Subtle", value: 35 },
  { id: "wide", label: "Wide", value: 70 },
];

describe("snapToNotch", () => {
  it("pulls a value within 6 % of the range onto the notch", () => {
    expect(snapToNotch(41, NOTCHES, 0, 100)).toEqual({ value: 35, notch: NOTCHES[1] });
    expect(snapToNotch(29, NOTCHES, 0, 100)).toEqual({ value: 35, notch: NOTCHES[1] });
    expect(snapToNotch(5.9, NOTCHES, 0, 100)).toEqual({ value: 0, notch: NOTCHES[0] });
  });

  it("leaves a value more than 6 % away where it is, rounded and clamped", () => {
    expect(snapToNotch(41.6, NOTCHES, 0, 100)).toEqual({ value: 42, notch: null });
    expect(snapToNotch(52, NOTCHES, 0, 100)).toEqual({ value: 52, notch: null });
    expect(snapToNotch(140, NOTCHES, 0, 100)).toEqual({ value: 100, notch: null });
  });
});

describe("stepNotch", () => {
  it("jumps to the next notch in either direction and stays at the ends", () => {
    expect(stepNotch(0, NOTCHES, 1)).toBe(35);
    expect(stepNotch(50, NOTCHES, 1)).toBe(70);
    expect(stepNotch(50, NOTCHES, -1)).toBe(35);
    expect(stepNotch(70, NOTCHES, 1)).toBe(70);
    expect(stepNotch(0, NOTCHES, -1)).toBe(0);
  });
});

describe("repeatStep", () => {
  it("moves a held key by 5 and stops at the range", () => {
    expect(NOTCH_REPEAT_STEP).toBe(5);
    expect(repeatStep(35, 1, 0, 100)).toBe(40);
    expect(repeatStep(35, -1, 0, 100)).toBe(30);
    expect(repeatStep(98, 1, 0, 100)).toBe(100);
    expect(repeatStep(2, -1, 0, 100)).toBe(0);
  });
});

describe("notchValueText", () => {
  it("names the nearest notch with the exact amount, and reads plain Off at zero", () => {
    expect(notchValueText(0, NOTCHES)).toBe("Off");
    expect(notchValueText(35, NOTCHES)).toBe("Subtle, 35");
    expect(notchValueText(60, NOTCHES)).toBe("Wide, 60");
    expect(notchValueText(10, NOTCHES)).toBe("Off, 10");
    expect(nearestNotch(52, NOTCHES).id).toBe("subtle");
  });
});

describe("track geometry", () => {
  it("maps a pointer to a value with the thumb kept inside the track", () => {
    expect(valueAtPosition(22, 244, 22, 0, 100)).toBe(0);
    expect(valueAtPosition(122, 244, 22, 0, 100)).toBe(50);
    expect(valueAtPosition(400, 244, 22, 0, 100)).toBe(100);
    expect(valueAtPosition(10, 40, 22, 0, 100)).toBe(0);
  });

  it("places a value with the same inset", () => {
    expect(positionCss(50, 0, 100, 22)).toBe("calc(22px + (100% - 44px) * 0.5000)");
    expect(positionCss(150, 0, 100, 22)).toBe("calc(22px + (100% - 44px) * 1.0000)");
    expect(positionCss(5, 5, 5, 22)).toBe("calc(22px + (100% - 44px) * 0.0000)");
  });
});
