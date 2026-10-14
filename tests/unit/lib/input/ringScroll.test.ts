import { describe, expect, it } from "vitest";

import { resolveRingScrollAlignment } from "@/lib/input/ringScroll";

/** A keypad handset: 427 CSS px tall, with the app bar and the guidance and tab bars reserved. */
const handset = { scrollportTop: 0, scrollportBottom: 427, marginTop: 117, marginBottom: 79 };

/**
 * Settings on a 320x426 screen, measured in a browser: the page scrolls in a container that starts
 * below the 49 px app bar and ends at the tab bar, and the anchor reserves 57 px above and 26.8 px
 * below inside it.
 */
const pageShell = { scrollportTop: 49, scrollportBottom: 376, marginTop: 57, marginBottom: 26.8 };

describe("aligning a ring stop the app has just moved to", () => {
  it("scrolls a card that fits the reserved area fully in when its bottom is below it", () => {
    // Home's Streams card, measured on the handset: 262 px inside a 289 px area, selected with
    // 31 px of it under the tab bar. "nearest" does nothing once the top is on screen.
    expect(resolveRingScrollAlignment({ ...handset, marginBottom: 21, top: 196, bottom: 458, height: 262 })).toBe(
      "end",
    );
  });

  it("aligns the start of a card taller than the reserved area", () => {
    // Home's Lighting card: 413 px, which cannot be shown whole at this size. The user descends
    // into it; aligning its end would push its first rows above the app bar.
    expect(resolveRingScrollAlignment({ ...handset, top: 196, bottom: 609, height: 413 })).toBe("start");
  });

  it("judges the fit inside the scroll container, so a card that only fits the window is aligned by its start", () => {
    // Settings' Diagnostics card, 314 px, reached from the card above it. Judged against the whole
    // window it fitted and was aligned by its end, which left its top at 36 px under the app bar.
    expect(resolveRingScrollAlignment({ ...pageShell, top: 1150, bottom: 1464, height: 314 })).toBe("start");
  });

  it("aligns the end of a card that fits the scroll container's reserved area", () => {
    expect(resolveRingScrollAlignment({ ...pageShell, top: 500, bottom: 700, height: 200 })).toBe("end");
  });

  it("brings a tall card's heading into view when the card was reached from below", () => {
    // Config's Memory & ROMs card, left open and selected by Back from a control inside it: 2810 px
    // tall with its top 2460 px above the screen.
    expect(resolveRingScrollAlignment({ ...handset, top: -2460, bottom: 350, height: 2810 })).toBe("start");
  });

  it("does not scroll a stop that is already within the reserved area", () => {
    expect(resolveRingScrollAlignment({ ...handset, top: 234, bottom: 298, height: 64 })).toBe("nearest");
  });

  it("scrolls in a short stop hidden behind the bottom bars though it is inside the viewport", () => {
    expect(resolveRingScrollAlignment({ ...handset, top: 380, bottom: 420, height: 40 })).toBe("end");
  });
});
