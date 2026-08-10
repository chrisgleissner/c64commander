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
        sectionSlugs: ["system-info", "quick-actions", "cpu-ram"],
      },
      {
        slug: "system-info-to-cpu-ram-part-2",
        scrollTop: 180,
        sectionSlugs: ["system-info", "quick-actions", "cpu-ram", "ports"],
      },
      {
        slug: "cpu-ram-to-audio",
        scrollTop: 420,
        sectionSlugs: ["cpu-ram", "ports", "video", "audio"],
      },
      {
        slug: "audio-to-keyboard-light",
        scrollTop: 620,
        sectionSlugs: ["audio", "user-interface", "case-light", "keyboard-light"],
      },
      {
        slug: "keyboard-light-to-printers",
        scrollTop: 860,
        sectionSlugs: ["keyboard-light", "drives", "printers"],
      },
      {
        slug: "printers-to-config",
        scrollTop: 1080,
        sectionSlugs: ["printers", "streams", "config"],
      },
    ]);

    expect(selected).toEqual([
      {
        fileName: "01-system-info-to-cpu-ram.png",
        slice: {
          slug: "system-info-to-cpu-ram",
          scrollTop: 0,
          sectionSlugs: ["system-info", "quick-actions", "cpu-ram"],
        },
      },
      {
        fileName: "02-cpu-ram-to-audio.png",
        slice: {
          slug: "cpu-ram-to-audio",
          scrollTop: 420,
          sectionSlugs: ["cpu-ram", "ports", "video", "audio"],
        },
      },
      {
        fileName: "03-audio-to-keyboard-light.png",
        slice: {
          slug: "audio-to-keyboard-light",
          scrollTop: 620,
          sectionSlugs: ["audio", "user-interface", "case-light", "keyboard-light"],
        },
      },
      {
        fileName: "04-keyboard-light-to-printers.png",
        slice: {
          slug: "keyboard-light-to-printers",
          scrollTop: 860,
          sectionSlugs: ["keyboard-light", "drives", "printers"],
        },
      },
      {
        fileName: "05-printers-to-config.png",
        slice: {
          slug: "printers-to-config",
          scrollTop: 1080,
          sectionSlugs: ["printers", "streams", "config"],
        },
      },
    ]);
  });

  it("falls back to monotonic continuation slices when a settled layout makes older pairings impossible", () => {
    const selected = selectCanonicalHomeScreenshotSlices([
      {
        slug: "system-info-to-cpu-ram",
        scrollTop: 8,
        sectionSlugs: ["system-info", "quick-actions", "cpu-ram"],
      },
      {
        slug: "cpu-ram-to-video",
        scrollTop: 514,
        sectionSlugs: ["cpu-ram", "ports", "video"],
      },
      {
        slug: "audio-to-lighting",
        scrollTop: 1020,
        sectionSlugs: ["audio", "lighting"],
      },
      {
        slug: "lighting-to-drives",
        scrollTop: 1526,
        sectionSlugs: ["lighting", "drives"],
      },
      {
        slug: "drives-to-printers",
        scrollTop: 2032,
        sectionSlugs: ["drives", "printers"],
      },
      {
        slug: "printers-to-streams",
        scrollTop: 2538,
        sectionSlugs: ["printers", "streams"],
      },
      {
        slug: "streams-to-config",
        scrollTop: 3032,
        sectionSlugs: ["streams", "config"],
      },
    ]);

    expect(selected).toEqual([
      {
        fileName: "01-system-info-to-cpu-ram.png",
        slice: {
          slug: "system-info-to-cpu-ram",
          scrollTop: 8,
          sectionSlugs: ["system-info", "quick-actions", "cpu-ram"],
        },
      },
      {
        fileName: "02-cpu-ram-to-audio.png",
        slice: {
          slug: "cpu-ram-to-video",
          scrollTop: 514,
          sectionSlugs: ["cpu-ram", "ports", "video"],
        },
      },
      {
        fileName: "03-audio-to-keyboard-light.png",
        slice: {
          slug: "audio-to-lighting",
          scrollTop: 1020,
          sectionSlugs: ["audio", "lighting"],
        },
      },
      {
        fileName: "04-keyboard-light-to-printers.png",
        slice: {
          slug: "lighting-to-drives",
          scrollTop: 1526,
          sectionSlugs: ["lighting", "drives"],
        },
      },
      {
        fileName: "05-printers-to-config.png",
        slice: {
          slug: "streams-to-config",
          scrollTop: 3032,
          sectionSlugs: ["streams", "config"],
        },
      },
    ]);
  });

  it("falls back to slices containing the trailing required section when no earlier pairing remains", () => {
    const selected = selectCanonicalHomeScreenshotSlices([
      {
        slug: "system-info-to-cpu-ram",
        scrollTop: 8,
        sectionSlugs: ["system-info", "quick-actions", "cpu-ram"],
      },
      {
        slug: "cpu-ram-to-video",
        scrollTop: 514,
        sectionSlugs: ["cpu-ram", "ports", "video"],
      },
      {
        slug: "keyboard-light-only",
        scrollTop: 1020,
        sectionSlugs: ["keyboard-light"],
      },
      {
        slug: "printers-only",
        scrollTop: 1526,
        sectionSlugs: ["printers"],
      },
      {
        slug: "config-only",
        scrollTop: 2032,
        sectionSlugs: ["config"],
      },
    ]);

    expect(selected).toEqual([
      {
        fileName: "01-system-info-to-cpu-ram.png",
        slice: {
          slug: "system-info-to-cpu-ram",
          scrollTop: 8,
          sectionSlugs: ["system-info", "quick-actions", "cpu-ram"],
        },
      },
      {
        fileName: "02-cpu-ram-to-audio.png",
        slice: {
          slug: "cpu-ram-to-video",
          scrollTop: 514,
          sectionSlugs: ["cpu-ram", "ports", "video"],
        },
      },
      {
        fileName: "03-audio-to-keyboard-light.png",
        slice: {
          slug: "keyboard-light-only",
          scrollTop: 1020,
          sectionSlugs: ["keyboard-light"],
        },
      },
      {
        fileName: "04-keyboard-light-to-printers.png",
        slice: {
          slug: "printers-only",
          scrollTop: 1526,
          sectionSlugs: ["printers"],
        },
      },
      {
        fileName: "05-printers-to-config.png",
        slice: {
          slug: "config-only",
          scrollTop: 2032,
          sectionSlugs: ["config"],
        },
      },
    ]);
  });
});
