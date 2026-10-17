/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { relativeLuminanceFromHsl } from "@/lib/appStyles/colorMath";
import { contrastRatio, heatCellHsl, heatCellTextColor, readableTextColor } from "@/lib/diagnostics/heatCellColors";

const textLuminance = (color: "#000000" | "#ffffff") => (color === "#ffffff" ? 1 : 0);

describe("heat cell text colors", () => {
  it("reaches 4.5:1 against the cell background at every intensity step", () => {
    for (let step = 1; step <= 100; step += 1) {
      const intensity = step / 100;
      const { hue, saturation, lightness } = heatCellHsl(intensity);
      const background = relativeLuminanceFromHsl(`${hue} ${saturation}% ${lightness}%`);
      const ratio = contrastRatio(background, textLuminance(heatCellTextColor(intensity)));
      expect(ratio, `intensity ${intensity}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("uses dark text on pale cells and light text on dark cells", () => {
    expect(readableTextColor("196 82% 96%")).toBe("#000000");
    expect(readableTextColor("12 88% 38%")).toBe("#ffffff");
  });
});
