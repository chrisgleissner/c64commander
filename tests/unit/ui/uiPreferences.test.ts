/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import {
  applyStoredTextScale,
  clampListPreviewLimit,
  DEFAULT_LIST_PREVIEW_LIMIT,
  getDisplayProfileOverride,
  getListPreviewLimit,
  getTextScaleId,
  MAX_LIST_PREVIEW_LIMIT,
  MIN_LIST_PREVIEW_LIMIT,
  setDisplayProfileOverride,
  setListPreviewLimit,
  setTextScaleId,
} from "@/lib/uiPreferences";
import { DEFAULT_TEXT_SCALE_ID, TEXT_SCALE_VARIABLE } from "@/lib/textScale";

const TEXT_SCALE_KEY = "c64u_text_scale";

const readTextScaleVariable = () => document.documentElement.style.getPropertyValue(TEXT_SCALE_VARIABLE);

describe("uiPreferences", () => {
  it("clamps list preview limits to bounds", () => {
    expect(clampListPreviewLimit(-5)).toBe(MIN_LIST_PREVIEW_LIMIT);
    expect(clampListPreviewLimit(999)).toBe(MAX_LIST_PREVIEW_LIMIT);
    expect(clampListPreviewLimit(22.9)).toBe(23);
  });

  it("returns default limit for non-finite values (NaN, Infinity)", () => {
    // Covers the !Number.isFinite(value) guard branch in clampLimit
    expect(clampListPreviewLimit(NaN)).toBe(DEFAULT_LIST_PREVIEW_LIMIT);
    expect(clampListPreviewLimit(Infinity)).toBe(DEFAULT_LIST_PREVIEW_LIMIT);
  });

  it("returns defaults when localStorage is unavailable", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      value: undefined,
      configurable: true,
    });

    expect(getListPreviewLimit()).toBe(DEFAULT_LIST_PREVIEW_LIMIT);

    if (original) {
      Object.defineProperty(globalThis, "localStorage", original);
    }
  });

  it("reads and writes list preview limits with events", () => {
    localStorage.clear();
    const handler = vi.fn();
    window.addEventListener("c64u-ui-preferences-changed", handler);

    setListPreviewLimit(75);

    expect(getListPreviewLimit()).toBe(75);
    expect(handler).toHaveBeenCalled();

    window.removeEventListener("c64u-ui-preferences-changed", handler);
  });

  it("setListPreviewLimit is a no-op when localStorage is unavailable", () => {
    // Covers: if (typeof localStorage === 'undefined') return in setListPreviewLimit (line 28)
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      value: undefined,
      configurable: true,
    });

    expect(() => setListPreviewLimit(100)).not.toThrow();

    if (original) {
      Object.defineProperty(globalThis, "localStorage", original);
    }
  });

  it("getDisplayProfileOverride returns 'auto' for invalid stored value", () => {
    localStorage.setItem("c64u_display_profile_override", "garbage");
    expect(getDisplayProfileOverride()).toBe("auto");
  });

  it("getDisplayProfileOverride returns 'auto' when localStorage is unavailable", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      value: undefined,
      configurable: true,
    });

    expect(getDisplayProfileOverride()).toBe("auto");

    if (original) {
      Object.defineProperty(globalThis, "localStorage", original);
    }
  });

  it("setDisplayProfileOverride is a no-op when localStorage is unavailable", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      value: undefined,
      configurable: true,
    });

    expect(() => setDisplayProfileOverride("compact")).not.toThrow();

    if (original) {
      Object.defineProperty(globalThis, "localStorage", original);
    }
  });

  it("stores the chosen text size and applies it to the document in the same call", () => {
    // The Settings control calls this and nothing else, so if the write and the apply
    // were not both done here the setting would either take effect only after a
    // restart or be lost on the next one.
    localStorage.clear();
    document.documentElement.style.removeProperty(TEXT_SCALE_VARIABLE);

    setTextScaleId("large");

    expect(localStorage.getItem(TEXT_SCALE_KEY)).toBe("large");
    expect(getTextScaleId()).toBe("large");
    expect(readTextScaleVariable()).toBe("1.15");
  });

  it("applies the stored text size at start-up", () => {
    // applyStoredTextScale runs once from the app entry point. A stored value that was
    // never applied would leave the app at the default size on every launch, which is
    // the failure the setting exists to prevent.
    localStorage.setItem(TEXT_SCALE_KEY, "large");
    document.documentElement.style.removeProperty(TEXT_SCALE_VARIABLE);

    applyStoredTextScale();

    expect(readTextScaleVariable()).toBe("1.15");
    expect(document.documentElement.dataset.textScale).toBe("large");
  });

  /*
   * "Larger" and "Largest" shipped before the cap and are still in users' storage. Reading one back
   * as the default would take text DOWN two steps for the users who most wanted it up, so it reads
   * back as the largest size still offered instead.
   */
  it("reads a retired text size back as the largest one still offered", () => {
    localStorage.setItem(TEXT_SCALE_KEY, "largest");
    document.documentElement.style.removeProperty(TEXT_SCALE_VARIABLE);

    applyStoredTextScale();

    expect(getTextScaleId()).toBe("large");
    expect(readTextScaleVariable()).toBe("1.15");
    expect(document.documentElement.dataset.textScale).toBe("large");
  });

  it("falls back to the default text size for a corrupt stored value", () => {
    // Storage survives downgrades and is user-writable, so an id this release does not
    // know must not resolve to an unreadable size.
    localStorage.setItem(TEXT_SCALE_KEY, "gigantic");
    expect(getTextScaleId()).toBe(DEFAULT_TEXT_SCALE_ID);
  });

  it("getTextScaleId returns the default when localStorage is unavailable", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      value: undefined,
      configurable: true,
    });

    expect(getTextScaleId()).toBe(DEFAULT_TEXT_SCALE_ID);

    if (original) {
      Object.defineProperty(globalThis, "localStorage", original);
    }
  });

  it("setTextScaleId still applies the size when localStorage is unavailable", () => {
    // Nothing can be persisted, but the user asked for larger text now: the request
    // must still take effect for this session rather than being dropped.
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      value: undefined,
      configurable: true,
    });
    document.documentElement.style.removeProperty(TEXT_SCALE_VARIABLE);

    expect(() => setTextScaleId("large")).not.toThrow();
    expect(readTextScaleVariable()).toBe("1.15");

    if (original) {
      Object.defineProperty(globalThis, "localStorage", original);
    }
  });
});
