import { describe, expect, it } from "vitest";
import {
  planHomeScreenshotSlices,
  selectCanonicalHomeScreenshotSlices,
} from "../../../playwright/homeScreenshotLayout";

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

  it("selects the canonical README Home storytelling slices", () => {
    const selected = selectCanonicalHomeScreenshotSlices([
      {
        slug: "system-info-to-cpu-ram",
        scrollTop: 0,
        sectionSlugs: ["system-info", "quick-actions", "quick-config", "cpu-ram"],
      },
      {
        slug: "system-info-to-cpu-ram-part-2",
        scrollTop: 180,
        sectionSlugs: ["system-info", "quick-actions", "quick-config", "cpu-ram", "ports"],
      },
      {
        slug: "quick-config-to-user-interface",
        scrollTop: 420,
        sectionSlugs: ["quick-config", "cpu-ram", "ports", "video", "user-interface"],
      },
      {
        slug: "quick-config-to-keyboard-light",
        scrollTop: 620,
        sectionSlugs: ["quick-config", "user-interface", "case-light", "keyboard-light"],
      },
      {
        slug: "quick-config-to-printers",
        scrollTop: 860,
        sectionSlugs: ["quick-config", "keyboard-light", "drives", "printers"],
      },
      {
        slug: "printers-to-sid",
        scrollTop: 1080,
        sectionSlugs: ["printers", "sid", "streams"],
      },
      {
        slug: "sid-to-config",
        scrollTop: 1300,
        sectionSlugs: ["sid", "streams", "config"],
      },
    ]);

    expect(selected).toEqual([
      {
        fileName: "01-system-info-to-cpu-ram.png",
        slice: {
          slug: "system-info-to-cpu-ram",
          scrollTop: 0,
          sectionSlugs: ["system-info", "quick-actions", "quick-config", "cpu-ram"],
        },
      },
      {
        fileName: "02-quick-config-to-keyboard-light.png",
        slice: {
          slug: "quick-config-to-keyboard-light",
          scrollTop: 620,
          sectionSlugs: ["quick-config", "user-interface", "case-light", "keyboard-light"],
        },
      },
      {
        fileName: "03-quick-config-to-printers.png",
        slice: {
          slug: "quick-config-to-printers",
          scrollTop: 860,
          sectionSlugs: ["quick-config", "keyboard-light", "drives", "printers"],
        },
      },
      {
        fileName: "04-printers-to-sid.png",
        slice: {
          slug: "printers-to-sid",
          scrollTop: 1080,
          sectionSlugs: ["printers", "sid", "streams"],
        },
      },
      {
        fileName: "05-sid-to-config.png",
        slice: {
          slug: "sid-to-config",
          scrollTop: 1300,
          sectionSlugs: ["sid", "streams", "config"],
        },
      },
    ]);
  });
});
