/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { isAuthoritativeConfigValueEqual } from "@/hooks/useAuthoritativeConfigValueState";

describe("isAuthoritativeConfigValueEqual", () => {
  it("returns true for identical strings", () => {
    expect(isAuthoritativeConfigValueEqual("foo", "foo")).toBe(true);
  });

  it("returns true for identical numbers", () => {
    expect(isAuthoritativeConfigValueEqual(4, 4)).toBe(true);
  });

  it("returns true when whitespace differs around a single token", () => {
    // The original CPU Speed freeze shipped " 4" from the device for a
    // committed `"4"`; strict Object.is left pending stuck.
    expect(isAuthoritativeConfigValueEqual("4", " 4")).toBe(true);
    expect(isAuthoritativeConfigValueEqual(" foo ", "foo")).toBe(true);
  });

  it("returns true for number / numeric-string drift", () => {
    expect(isAuthoritativeConfigValueEqual(4, "4")).toBe(true);
    expect(isAuthoritativeConfigValueEqual("4", 4)).toBe(true);
    expect(isAuthoritativeConfigValueEqual("4", " 4 ")).toBe(true);
  });

  it("does not coerce multi-token strings to numbers", () => {
    // "1 2 3" must not parseFloat to 1 and equal numeric 1.
    expect(isAuthoritativeConfigValueEqual("1 2 3", 1)).toBe(false);
  });

  it("returns false for genuinely different values", () => {
    expect(isAuthoritativeConfigValueEqual("foo", "bar")).toBe(false);
    expect(isAuthoritativeConfigValueEqual(4, 5)).toBe(false);
    expect(isAuthoritativeConfigValueEqual("4", "5")).toBe(false);
  });

  it("treats empty / whitespace-only strings as not-numeric", () => {
    expect(isAuthoritativeConfigValueEqual("", 0)).toBe(false);
    expect(isAuthoritativeConfigValueEqual("   ", 0)).toBe(false);
  });

  it("does not equate NaN with 0 via numeric coercion", () => {
    // tryParseNumeric returns null for NaN; the string-trim fallback then
    // compares "NaN" vs "0" which differ.
    expect(isAuthoritativeConfigValueEqual(Number.NaN, 0)).toBe(false);
  });
});
