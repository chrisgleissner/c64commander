/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PaletteSwatchStrip, VIC_INDEX_NAMES } from "@/components/palette/PaletteSwatchStrip";
import { VIC_PALETTES, paletteEntryHex } from "@/lib/streams/vicPalette";

const COOL = VIC_PALETTES.find((palette) => palette.id === "cool")!;

describe("PaletteSwatchStrip", () => {
  it("draws all sixteen colors of the palette", () => {
    render(<PaletteSwatchStrip palette={COOL} testId="strip" />);

    const strip = screen.getByTestId("strip");
    expect(strip.children).toHaveLength(16);
    COOL.rgb.forEach((_, index) => {
      const swatch = screen.getByTestId(`strip-swatch-${index}`);
      const [r, g, b] = COOL.rgb[index]!;
      expect(swatch).toHaveStyle({ background: `rgb(${r}, ${g}, ${b})` });
      expect(swatch).toHaveAttribute("title", `${index}: ${VIC_INDEX_NAMES[index]} ${paletteEntryHex(COOL, index)}`);
    });
  });

  it("names the palette for anyone who cannot see the swatches", () => {
    render(<PaletteSwatchStrip palette={COOL} testId="strip" />);
    expect(screen.getByRole("img", { name: "Cool palette, sixteen colors" })).toBe(screen.getByTestId("strip"));
  });

  it("takes the height and extra classes it is given", () => {
    render(<PaletteSwatchStrip palette={COOL} testId="strip" height="h-5" className="mt-2" />);

    expect(screen.getByTestId("strip")).toHaveClass("mt-2");
    expect(screen.getByTestId("strip-swatch-0")).toHaveClass("h-5");
  });

  it("falls back to its own height and leaves the swatches untagged without a test id", () => {
    const { container } = render(<PaletteSwatchStrip palette={COOL} />);

    const strip = screen.getByRole("img", { name: "Cool palette, sixteen colors" });
    expect(strip).not.toHaveAttribute("data-testid");
    expect(strip.children[0]).toHaveClass("h-6");
    expect(container.querySelectorAll("[data-testid]")).toHaveLength(0);
  });
});
