/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { APP_STYLES, DEVICE_SCHEME_TO_STYLE_ID } from "@/generated/appStyles";
import { MATCH_MY_DEVICE_SENTINEL, resolveMatchMyDeviceStyleId } from "@/lib/appStyles/matchMyDevice";

describe("resolveMatchMyDeviceStyleId", () => {
  it("maps every device Color Scheme name in the generated table (spec.md section 7.4)", () => {
    expect(Object.keys(DEVICE_SCHEME_TO_STYLE_ID)).toEqual(
      expect.arrayContaining([
        "Ultimate Black",
        "Commodore Blue",
        "Commodore 1",
        "Commodore 2",
        "Commodore 3",
        "C128 Style",
      ]),
    );
  });

  it.each(Object.entries(DEVICE_SCHEME_TO_STYLE_ID))("maps %s -> %s", (scheme, expectedStyleId) => {
    expect(resolveMatchMyDeviceStyleId(scheme)).toBe(expectedStyleId);
  });

  it("maps the three Commodore aliases to the same style, per research.md section 1", () => {
    const mapped = ["Commodore Blue", "Commodore 1", "Commodore 2", "Commodore 3"].map((scheme) =>
      resolveMatchMyDeviceStyleId(scheme),
    );
    expect(new Set(mapped).size).toBe(1);
  });

  it("returns null for an unknown scheme name", () => {
    expect(resolveMatchMyDeviceStyleId("Some Future Scheme")).toBeNull();
  });

  it("returns null when the device has never been probed", () => {
    expect(resolveMatchMyDeviceStyleId(null)).toBeNull();
  });

  it("every mapped style id is a real, currently-declared style", () => {
    const ids = new Set(APP_STYLES.map((style) => style.id));
    for (const styleId of Object.values(DEVICE_SCHEME_TO_STYLE_ID)) {
      expect(ids.has(styleId)).toBe(true);
    }
  });

  it("the sentinel is not itself a real style id", () => {
    expect(APP_STYLES.some((style) => style.id === MATCH_MY_DEVICE_SENTINEL)).toBe(false);
  });
});
