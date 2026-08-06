/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  BASE_ROOT_FONT_SIZE_PX,
  DEFAULT_TEXT_SCALE_ID,
  ROOT_FONT_SIZE_VARIABLE,
  TEXT_SCALE_OPTIONS,
  applyTextScaleToDocument,
  isTextScaleId,
  resolveRootFontSizePx,
  resolveTextScale,
} from "@/lib/textScale";

describe("text scale", () => {
  it("never makes text smaller than the design baseline", () => {
    // The whole point of the setting is to make text bigger. A stored value that
    // shrank it would defeat the accessibility reason it exists, so every option and
    // every unrecognised input must resolve to at least the base size.
    for (const option of TEXT_SCALE_OPTIONS) {
      expect(resolveRootFontSizePx(option.id)).toBeGreaterThanOrEqual(BASE_ROOT_FONT_SIZE_PX);
    }
    expect(resolveRootFontSizePx("default")).toBe(BASE_ROOT_FONT_SIZE_PX);
  });

  it("falls back to the default for an unknown or corrupt stored value", () => {
    // Storage is user-writable and survives downgrades, so a value from a future
    // release or a corrupted entry must not leave the app unreadable.
    expect(resolveTextScale("not-a-scale")).toBe(1);
    expect(resolveTextScale(null)).toBe(1);
    expect(resolveTextScale(undefined)).toBe(1);
    expect(resolveRootFontSizePx("enormous")).toBe(BASE_ROOT_FONT_SIZE_PX);
  });

  it("caps how far the setting can go", () => {
    // An unbounded scale breaks every layout at once. The largest option is the cap.
    const largest = Math.max(...TEXT_SCALE_OPTIONS.map((option) => option.scale));
    expect(largest).toBeLessThanOrEqual(1.5);
    expect(resolveRootFontSizePx("largest")).toBe(BASE_ROOT_FONT_SIZE_PX * 1.5);
  });

  it("increases monotonically through the options", () => {
    // Options are presented in order, so each must actually be larger than the last -
    // otherwise picking "Larger" could make text smaller.
    const sizes = TEXT_SCALE_OPTIONS.map((option) => resolveRootFontSizePx(option.id));
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

  it("applies the setting through the existing root font size variable", () => {
    // Set as a CSS variable rather than as an inline font-size, so the stylesheet keeps
    // a single owner of the root size instead of two that could disagree.
    applyTextScaleToDocument("larger");
    const root = document.documentElement;
    expect(root.style.getPropertyValue(ROOT_FONT_SIZE_VARIABLE)).toBe(`${BASE_ROOT_FONT_SIZE_PX * 1.3}px`);
    expect(root.dataset.textScale).toBe("larger");

    applyTextScaleToDocument("rubbish");
    expect(root.style.getPropertyValue(ROOT_FONT_SIZE_VARIABLE)).toBe(`${BASE_ROOT_FONT_SIZE_PX}px`);
    expect(root.dataset.textScale).toBe(DEFAULT_TEXT_SCALE_ID);
  });
});
