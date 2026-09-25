/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { resolveKeyCapFontSizes } from "@/lib/remoteInput/keyCapTypography";

describe("resolveKeyCapFontSizes", () => {
  it.each(["compact", "medium"] as const)("keeps every keycap text size at or above 14 px on %s", (profile) => {
    const sizes = resolveKeyCapFontSizes(profile);

    expect(Math.min(sizes.label, sizes.stackedLabel, sizes.legend)).toBeGreaterThanOrEqual(14);
  });

  it("returns the same object on every call so memoised keys do not re-render", () => {
    expect(resolveKeyCapFontSizes("medium")).toBe(resolveKeyCapFontSizes("medium"));
    expect(resolveKeyCapFontSizes("expanded")).toBe(resolveKeyCapFontSizes("expanded"));
  });
});
