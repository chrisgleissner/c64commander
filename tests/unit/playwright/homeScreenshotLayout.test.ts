import { describe, expect, it } from "vitest";
import { planHomeScreenshotSlices } from "../../../playwright/homeScreenshotLayout";

describe("planHomeScreenshotSlices", () => {
  it("groups smaller adjacent sections into minimally overlapping slices", () => {
    const slices = planHomeScreenshotSlices({
      sections: [
        { slug: "system-info", top: 100, bottom: 220 },
        { slug: "quick-actions", top: 240, bottom: 420 },
        { slug: "quick-config", top: 450, bottom: 920 },
        { slug: "drives", top: 940, bottom: 1160 },
        { slug: "streams", top: 1190, bottom: 1410 },
      ],
      viewportHeight: 800,
      topInset: 88,
      bottomInset: 96,
      maxScroll: 800,
    });

    expect(slices).toEqual([
      {
        slug: "system-info-to-quick-config",
        scrollTop: 0,
        sectionSlugs: ["system-info", "quick-actions", "quick-config"],
      },
      {
        slug: "quick-config-to-streams",
        scrollTop: 568,
        sectionSlugs: ["quick-config", "drives", "streams"],
      },
      {
        slug: "quick-config-to-streams-part-2",
        scrollTop: 800,
        sectionSlugs: ["quick-config", "drives", "streams"],
      },
    ]);
  });

  it("creates continuation slices for tall sections instead of clipping them", () => {
    const slices = planHomeScreenshotSlices({
      sections: [{ slug: "quick-config", top: 320, bottom: 1220 }],
      viewportHeight: 800,
      topInset: 88,
      bottomInset: 96,
      maxScroll: 900,
    });

    expect(slices).toEqual([
      {
        slug: "quick-config",
        scrollTop: 220,
        sectionSlugs: ["quick-config"],
      },
      {
        slug: "quick-config-part-2",
        scrollTop: 788,
        sectionSlugs: ["quick-config"],
      },
    ]);
  });
});
