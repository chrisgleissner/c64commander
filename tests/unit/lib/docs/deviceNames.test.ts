/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import * as manual from "../../../../scripts/build-manuals.mjs";
import { appDeviceName, targetDeviceDescription, targetDeviceShortName } from "@/lib/docs/deviceNames";

const VARIANTS = ["c64commander", "c64u-remote"] as const;

describe("in-app guide device names", () => {
  it.each(VARIANTS)("call both machines what the %s manual calls them", (variantId) => {
    const variant = { id: variantId };
    expect(appDeviceName(variantId)).toBe(manual.appDeviceName(variant));
    expect(targetDeviceShortName(variantId)).toBe(manual.targetDeviceShortName(variant));
    expect(targetDeviceDescription(variantId)).toBe(manual.targetDeviceDescription(variant));
  });

  it("say phone, never a phone model, in the keypad edition and phone or tablet in the broad one", () => {
    expect(appDeviceName("c64u-remote")).toBe("phone");
    expect(appDeviceName("c64commander")).toBe("phone or tablet");
    expect(targetDeviceShortName("c64u-remote")).toBe("the Commodore 64 Ultimate");
    expect(targetDeviceShortName("c64commander")).toBe("the connected Ultimate-family device");
  });
});
