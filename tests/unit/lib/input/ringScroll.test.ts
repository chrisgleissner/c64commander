import { describe, expect, it } from "vitest";

import { resolveRingScrollAlignment } from "@/lib/input/ringScroll";

/** The 8020 handset: 427 CSS px tall, with the app bar and the guidance and tab bars reserved. */
const handset = { viewportHeight: 427, marginTop: 117, marginBottom: 79 };

describe("aligning a ring stop the app has just moved to", () => {
  it("scrolls a card that fits the reserved area fully in when its bottom is below it", () => {
    // Home's Streams card, measured on the handset: 262 px inside a 289 px area, selected with
    // 31 px of it under the tab bar. "nearest" does nothing once the top is on screen.
    expect(resolveRingScrollAlignment({ ...handset, marginBottom: 21, top: 196, bottom: 458, height: 262 })).toBe(
      "end",
    );
  });

  it("leaves a card taller than the reserved area showing its start", () => {
    // Home's Lighting card: 413 px, which cannot be shown whole at this size. The user descends
    // into it; aligning its end would push its first rows above the app bar.
    expect(resolveRingScrollAlignment({ ...handset, top: 196, bottom: 609, height: 413 })).toBe("nearest");
  });

  it("does not scroll a stop that is already within the reserved area", () => {
    expect(resolveRingScrollAlignment({ ...handset, top: 234, bottom: 298, height: 64 })).toBe("nearest");
  });

  it("scrolls in a short stop hidden behind the bottom bars though it is inside the viewport", () => {
    expect(resolveRingScrollAlignment({ ...handset, top: 380, bottom: 420, height: 40 })).toBe("end");
  });
});
