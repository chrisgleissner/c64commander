/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { reserveGuidanceHeight } from "@/components/input/KeypadGuidanceBar";
import { KEYPAD_GUIDANCE_RESERVE_EVENT } from "@/lib/ui/keypadGuidanceReserve";

const RESERVED = "var(--keypad-guidance-bar-height)";
const root = () => document.documentElement.style;
const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe("reserveGuidanceHeight", () => {
  afterEach(() => {
    root().removeProperty("--keypad-guidance-reserved-height");
    vi.restoreAllMocks();
  });

  it("writes nothing when the bar hides and shows again within one task", async () => {
    // Opening a dialog hid and showed the bar in one task; each write restyled the whole document.
    root().setProperty("--keypad-guidance-reserved-height", RESERVED);
    const setProperty = vi.spyOn(CSSStyleDeclaration.prototype, "setProperty");
    const onReserve = vi.fn();
    window.addEventListener(KEYPAD_GUIDANCE_RESERVE_EVENT, onReserve);

    reserveGuidanceHeight(false);
    reserveGuidanceHeight(true);
    await settle();

    expect(setProperty).not.toHaveBeenCalled();
    expect(onReserve).not.toHaveBeenCalled();
    expect(root().getPropertyValue("--keypad-guidance-reserved-height")).toBe(RESERVED);
    window.removeEventListener(KEYPAD_GUIDANCE_RESERVE_EVENT, onReserve);
  });

  it("applies the last request once, after the current task", async () => {
    root().setProperty("--keypad-guidance-reserved-height", RESERVED);
    const onReserve = vi.fn();
    window.addEventListener(KEYPAD_GUIDANCE_RESERVE_EVENT, onReserve);

    reserveGuidanceHeight(true);
    reserveGuidanceHeight(false);
    expect(root().getPropertyValue("--keypad-guidance-reserved-height")).toBe(RESERVED);
    await settle();

    expect(root().getPropertyValue("--keypad-guidance-reserved-height")).toBe("0px");
    expect(onReserve).toHaveBeenCalledTimes(1);
    window.removeEventListener(KEYPAD_GUIDANCE_RESERVE_EVENT, onReserve);
  });
});
