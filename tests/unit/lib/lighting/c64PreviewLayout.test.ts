import { describe, expect, it } from "vitest";

import { C64_PREVIEW_LAYOUT, parseC64PreviewLayout } from "@/lib/lighting/c64PreviewLayout";

describe("C64 preview layout", () => {
  it("classifies case, keyboard, and LED regions from the authoritative ASCII layout", () => {
    expect(C64_PREVIEW_LAYOUT.width).toBe(67);
    expect(C64_PREVIEW_LAYOUT.height).toBe(15);

    expect(C64_PREVIEW_LAYOUT.regions.case.components).toHaveLength(1);
    expect(C64_PREVIEW_LAYOUT.regions.keyboard.components).toHaveLength(2);
    expect(C64_PREVIEW_LAYOUT.regions.led.components).toHaveLength(1);

    expect(C64_PREVIEW_LAYOUT.regions.case.cellCount).toBeGreaterThan(C64_PREVIEW_LAYOUT.regions.keyboard.cellCount);
    expect(C64_PREVIEW_LAYOUT.regions.led.cellCount).toBe(2);
    expect(C64_PREVIEW_LAYOUT.ledStrip.bounds).toEqual({ x: 58, y: 2, width: 2, height: 1 });
    expect(C64_PREVIEW_LAYOUT.keyboardMain.bounds.x).toBeLessThan(C64_PREVIEW_LAYOUT.keyboardFunction!.bounds.x);
  });

  it("supports layouts with a single keyboard component and no function block", () => {
    const layout = parseC64PreviewLayout(["xx_x", "x--x", "xxxx"].join("\n"));

    expect(layout.regions.keyboard.components).toHaveLength(1);
    expect(layout.keyboardFunction).toBeNull();
    expect(layout.ledStrip.bounds).toEqual({ x: 2, y: 0, width: 1, height: 1 });
  });

  it("rejects malformed or incomplete ASCII layouts", () => {
    expect(() => parseC64PreviewLayout("")).toThrow(/must not be empty/i);
    expect(() => parseC64PreviewLayout("xx\nx")).toThrow(/expected 2/i);
    expect(() => parseC64PreviewLayout("xx\nxz")).toThrow(/unsupported glyph/i);
    expect(() => parseC64PreviewLayout(["x_x", "xxx"].join("\n"))).toThrow(/at least one keyboard component/i);
    expect(() => parseC64PreviewLayout(["xxx", "x-x"].join("\n"))).toThrow(/exactly one LED strip component/i);
    expect(() => parseC64PreviewLayout(["x_x_x", "x---x"].join("\n"))).toThrow(/exactly one LED strip component/i);
  });
});
