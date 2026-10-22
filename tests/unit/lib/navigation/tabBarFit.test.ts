/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { tabLabelsOverflow } from "@/lib/navigation/tabBarFit";

const labelWidths = [53, 38, 49, 57, 71, 43];

describe("tabLabelsOverflow", () => {
  it("fits when the labels plus padding are narrower than the bar", () => {
    expect(tabLabelsOverflow({ labelWidths, minTabWidth: 44, tabPadding: 4, availableWidth: 345 })).toBe(false);
  });

  it("overflows when the labels are wider than the bar", () => {
    expect(tabLabelsOverflow({ labelWidths, minTabWidth: 44, tabPadding: 4, availableWidth: 335 })).toBe(true);
  });

  it("counts the touch target floor for a label narrower than it", () => {
    expect(tabLabelsOverflow({ labelWidths: [10, 10], minTabWidth: 44, tabPadding: 0, availableWidth: 80 })).toBe(true);
    expect(tabLabelsOverflow({ labelWidths: [10, 10], minTabWidth: 44, tabPadding: 0, availableWidth: 88 })).toBe(
      false,
    );
  });
});
