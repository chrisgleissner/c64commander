/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEXT_SCALE_ID,
  TEXT_SCALE_OPTIONS,
  TEXT_SCALE_VARIABLE,
  applyTextScaleToDocument,
  isTextScaleId,
  LARGEST_TEXT_SCALE_ID,
  MAX_TEXT_SCALE,
  normalizeTextScaleId,
  RETIRED_TEXT_SCALE_IDS,
  resolveTextScale,
} from "@/lib/textScale";

describe("text scale", () => {
  it("never makes text smaller than the design baseline", () => {
    // The whole point of the setting is to make text bigger. A stored value that
    // shrank it would defeat the accessibility reason it exists, so every option and
    // every unrecognised input must resolve to at least 1.
    for (const option of TEXT_SCALE_OPTIONS) {
      expect(resolveTextScale(option.id)).toBeGreaterThanOrEqual(1);
    }
    expect(resolveTextScale("default")).toBe(1);
  });

  it("falls back to the default for an unknown or corrupt stored value", () => {
    // Storage is user-writable and survives downgrades, so a value from a future
    // release or a corrupted entry must not leave the app unreadable.
    expect(resolveTextScale("not-a-scale")).toBe(1);
    expect(resolveTextScale(null)).toBe(1);
    expect(resolveTextScale(undefined)).toBe(1);
    expect(resolveTextScale("enormous")).toBe(1);
  });

  it("caps how far the setting can go", () => {
    // An unbounded scale breaks every layout at once. The largest option is the cap.
    const largest = Math.max(...TEXT_SCALE_OPTIONS.map((option) => option.scale));
    expect(largest).toBeLessThanOrEqual(MAX_TEXT_SCALE);
    expect(resolveTextScale("large")).toBe(MAX_TEXT_SCALE);
  });

  it("increases monotonically through the options", () => {
    // Options are presented in order, so each must actually be larger than the last -
    // otherwise picking "Larger" could make text smaller.
    const sizes = TEXT_SCALE_OPTIONS.map((option) => resolveTextScale(option.id));
    for (let index = 1; index < sizes.length; index += 1) {
      expect(sizes[index]).toBeGreaterThan(sizes[index - 1]);
    }
  });

  it("recognises exactly the ids it offers", () => {
    for (const option of TEXT_SCALE_OPTIONS) {
      expect(isTextScaleId(option.id)).toBe(true);
    }
    expect(isTextScaleId("huge")).toBe(false);
    expect(isTextScaleId(2)).toBe(false);
  });

  it("applies the setting as its own variable, not the display profile's", () => {
    // Deliberately NOT --display-profile-root-font-size: useDisplayProfile rewrites that
    // one every time the profile is evaluated, so a setting written there would be
    // silently overwritten and the control would appear to do nothing. Writing a
    // separate multiplier that the `html` rule composes gives each variable one owner.
    applyTextScaleToDocument("large");
    const root = document.documentElement;
    expect(root.style.getPropertyValue(TEXT_SCALE_VARIABLE)).toBe("1.15");
    expect(root.style.getPropertyValue("--display-profile-root-font-size")).toBe("");
    expect(root.dataset.textScale).toBe("large");

    applyTextScaleToDocument("rubbish");
    expect(root.style.getPropertyValue(TEXT_SCALE_VARIABLE)).toBe("1");
    expect(root.dataset.textScale).toBe(DEFAULT_TEXT_SCALE_ID);
  });

  /*
   * "Larger" (1.3) and "Largest" (1.5) shipped before the cap. On a 392 CSS-pixel handset 1.3 hid
   * half of every Config section title behind a two-line clamp and pushed a tab off the bar, and
   * 1.5 cut the page title itself. They are gone, but a user who picked one still has it in
   * storage, and reading it back as the default would take their text down two steps.
   */
  it("resolves a retired id to the largest size still offered", () => {
    for (const retired of RETIRED_TEXT_SCALE_IDS) {
      expect(normalizeTextScaleId(retired)).toBe(LARGEST_TEXT_SCALE_ID);
      expect(resolveTextScale(retired)).toBe(MAX_TEXT_SCALE);
    }
    expect(normalizeTextScaleId("not-a-scale")).toBe(DEFAULT_TEXT_SCALE_ID);
  });

  it("offers no size the layout cannot draw whole", () => {
    // Measured on the handset across all six pages: 1.15 renders every label, 1.3 does not.
    for (const option of TEXT_SCALE_OPTIONS) {
      expect(option.scale).toBeLessThanOrEqual(1.15);
    }
  });

  it("does nothing, rather than throwing, when there is no document", () => {
    // The module documents itself as safe to call before the DOM exists. Nothing in the
    // app reaches it that way today - the entry point runs in a browser - so this pins
    // the documented contract for any future caller that runs earlier.
    const root = document.documentElement;
    applyTextScaleToDocument("large");
    const before = root.style.getPropertyValue(TEXT_SCALE_VARIABLE);

    const original = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "document", { value: undefined, configurable: true });
    try {
      expect(() => applyTextScaleToDocument("largest")).not.toThrow();
    } finally {
      if (original) Object.defineProperty(globalThis, "document", original);
    }

    expect(root.style.getPropertyValue(TEXT_SCALE_VARIABLE)).toBe(before);
  });
});
